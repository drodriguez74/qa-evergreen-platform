#!/usr/bin/env node
/**
 * a11y_remediator.mjs — Tier 4 accessibility-remediation agent.
 *
 * The strategic flip: the locator strategy already DETECTS missing-ARIA gaps
 * (Tier 1 records them as `locator.debt` / `strategy:'unresolved'`, and the
 * snapshot strings expose interactive-but-unlabeled nodes like
 * `generic "☰" [ref=e4] clickable [cursor:pointer]`). Instead of only routing
 * around those gaps, this agent turns them into an accessibility-compliance
 * deliverable: it scans the profile's existing trace(s) ON DISK (no live
 * discovery), classifies a11y DEBT, and emits a draft remediation a dev can
 * apply — a copy-pasteable patch suggestion per finding plus a PR description.
 *
 * It NEVER opens a real PR and NEVER drives a browser. It works only from
 * trace/snapshot data already written by the discovery agents.
 *
 * Model usage: OPTIONAL. If the gateway (:4100, read-only) is reachable it asks
 * the reasoning tier to phrase a human-readable aria-label from the glyph +
 * context (e.g. `☰` → "Open menu"). If the gateway is down or 429s, it falls
 * back to a deterministic guess — exactly the platform's "fail open" rule.
 *
 * Usage:  QA_PROFILE=fundflow  node toolkit/agents/a11y_remediator.mjs
 *         QA_PROFILE=orangehrm node toolkit/agents/a11y_remediator.mjs
 *
 * Output: <workDir>/a11y-debt-report.json
 *         <workDir>/a11y-debt-report.md
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadProfile } from '../profile.mjs';
import { callGateway } from '../gateway-client.mjs';

const profile = loadProfile();
const WORK_DIR = profile.workDir;

// ---------------------------------------------------------------------------
// 1. Load every trace on disk for this profile (no live discovery).
// ---------------------------------------------------------------------------

function loadTraces(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    throw new Error(`workDir not found: ${dir} (run discovery first, or check QA_PROFILE)`);
  }
  const traces = [];
  for (const f of entries) {
    if (!/^trace\..*\.json$/.test(f)) continue;
    const path = join(dir, f);
    try {
      traces.push({ file: f, path, trace: JSON.parse(readFileSync(path, 'utf8')) });
    } catch (e) {
      console.warn(`  skip ${f}: not valid JSON (${e.message})`);
    }
  }
  return traces;
}

// ---------------------------------------------------------------------------
// 2. What counts as a11y DEBT.
//
//   (a) Tier-1 locator debt — the discoverer already couldn't reach an element
//       by role+name. `locator.debt === true` or `strategy === 'unresolved'`.
//       These are the actions the test had to degrade or skip; each one is a
//       real element a user-of-AT can't address either.
//
//   (b) Interactive-but-unlabeled nodes in the snapshot string — a node that is
//       clickable / [onclick] / [cursor:pointer] but whose ROLE is `generic`
//       (or empty) and/or whose accessible NAME is missing, OR whose only
//       "name" is an icon-only glyph (☰ ✕ ⚙ …). These are the gaps even when no
//       journey action targeted them.
// ---------------------------------------------------------------------------

// Icon-only / symbol glyphs that read as garbage to a screen reader.
const GLYPH_RE = /[←-⇿⌀-➿⬀-⯿-\u{1F000}-\u{1FAFF}]/u;

// Map a known glyph to a sensible default label (deterministic fallback).
const GLYPH_LABELS = {
  '☰': 'Open menu',
  '≡': 'Open menu',
  '⋮': 'More options',
  '⋯': 'More options',
  '✕': 'Close',
  '✖': 'Close',
  '×': 'Close',
  '⚙': 'Settings',
  '🔍': 'Search',
  '🔔': 'Notifications',
  '➕': 'Add',
  '＋': 'Add',
  '←': 'Back',
  '→': 'Forward',
  '⬅': 'Back',
  '➡': 'Forward',
};

// True if a snapshot text/name is just icon glyphs (no real words).
function isGlyphOnly(text) {
  if (!text) return false;
  const stripped = text.replace(/[\s​-‍﻿]/g, '');
  if (!stripped) return false;
  // No ASCII letters/digits, and contains at least one symbol glyph.
  return !/[A-Za-z0-9]/.test(stripped) && GLYPH_RE.test(stripped);
}

// Pull a snapshot YAML string out of agent-browser's snapshot object (or a
// bare string), tolerating both trace shapes.
function snapStr(s) {
  if (typeof s === 'string') return s;
  if (typeof s?.data?.snapshot === 'string') return s.data.snapshot;
  return '';
}

// Every snapshot string attached to a step: the step's own post-action snapshot
// PLUS the gating step's pre/post snapshots (where pre-login screens — and their
// `paragraph "Forgot your password?"` — actually live).
function stepSnapshotStrings(step) {
  const out = [];
  const main = snapStr(step?.snapshot);
  if (main) out.push(main);
  const csc = step?.causedStateChange;
  if (csc) {
    const pre = snapStr(csc.preSnapshot);
    const post = snapStr(csc.postSnapshot);
    if (pre) out.push(pre);
    if (post) out.push(post);
  }
  return out;
}

// PASSIVE roles that, when made clickable, are clear a11y debt: a screen reader
// announces them as static content, so a user-of-AT gets no signal the element
// is actionable. A clickable `<p onclick>` ("Forgot your password?") or a
// clickable `<div>` (role=generic) used as a button lands here.
//
// We deliberately do NOT flag clickable STRUCTURAL/composite roles
// (row, cell, gridcell, listitem, option, treeitem, tab…): those are
// legitimately clickable inside grids/menus/trees and have proper semantics.
const PASSIVE_CLICKABLE_ROLES = new Set([
  'generic', 'none', '', 'paragraph', 'text', 'img', 'image', 'heading', 'emphasis',
]);

// Parse `- <role> "quoted text" [ref=eN] ...trailing...` lines and flag the
// interactive-but-unlabeled ones. Mirrors journey_discoverer's line regex.
const LINE_RE = /^\s*-\s+(\S+)(?:\s+"((?:[^"\\]|\\.)*)")?[^\n]*?\[ref=(e\d+)\]([^\n]*)$/;

function scanSnapshotNodes(snapStr) {
  const findings = [];
  for (const line of snapStr.split('\n')) {
    const m = line.match(LINE_RE);
    if (!m) continue;
    const role = m[1];
    const text = m[2] != null ? m[2].replace(/\\"/g, '"') : '';
    const ref = m[3];
    const trailing = m[4] || '';

    const interactive = /\bclickable\b|\[onclick\]|cursor:pointer/.test(trailing);
    if (!interactive) continue;

    const glyphOnly = isGlyphOnly(text);
    const unnamed = text.trim() === '';
    const passiveRole = PASSIVE_CLICKABLE_ROLES.has(role);

    // Flag only the clear-cut debt:
    //   - an icon-only glyph control (any role), OR
    //   - an unnamed clickable node (any role — nothing to announce), OR
    //   - a clickable node with a PASSIVE role (div/p/img used as a button).
    // A clickable structural/composite role (row, listitem, option…) with a
    // real name is left alone — that's a legitimate widget pattern.
    if (!glyphOnly && !unnamed && !passiveRole) continue;

    // The top-level page wrapper often shows up as one giant generic clickable
    // node whose "text" is the whole page concatenated. That's a snapshot
    // artifact, not a real control — skip long-text generics that aren't glyphs.
    const looksLikePageWrapper = role === 'generic' && text.length > 60 && !glyphOnly;
    if (looksLikePageWrapper) continue;

    let why;
    if (glyphOnly) why = `icon-only control (glyph "${text}") with no accessible name`;
    else if (unnamed) why = `interactive ${role} node has no accessible name`;
    else why = `clickable node has a passive role "${role}" (e.g. a div/p used as a button) — assistive tech won't announce it as actionable, and it has no button/link semantics or aria-label`;

    findings.push({
      source: 'snapshot-node',
      role,
      visibleText: text,
      glyph: glyphOnly ? text : null,
      ref,
      signature: line.trim(),
      why,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 3. Suggest an aria-label — gateway (reasoning tier) if up, else deterministic.
// ---------------------------------------------------------------------------

function deterministicLabel(finding) {
  if (finding.glyph) {
    // Match any known glyph contained in the text.
    for (const [g, label] of Object.entries(GLYPH_LABELS)) {
      if (finding.glyph.includes(g)) return label;
    }
    return 'Activate control'; // unknown glyph — generic but honest
  }
  if (finding.visibleText && finding.visibleText.trim()) {
    // Text is present but on the wrong role — reuse the visible text verbatim.
    return finding.visibleText.trim();
  }
  if (finding.target?.name) return finding.target.name;
  return 'Interactive element';
}

async function gatewayLabel(finding, context) {
  const url = (profile.gateway?.url || 'http://localhost:4100').replace(/\/$/, '');
  const body = {
    repo: profile.name,
    tier: 'reasoning',
    system:
      'You write concise, human-readable aria-label values for unlabeled interactive UI ' +
      'elements so screen-reader users can understand them. Use imperative phrasing for ' +
      'controls (e.g. "Open menu", "Close dialog"). 1-4 words. No trailing punctuation.',
    messages: [
      {
        role: 'user',
        content:
          `An interactive element has no accessible name.\n` +
          `Role in the DOM: ${finding.role}\n` +
          `Visible text / glyph: ${JSON.stringify(finding.visibleText || finding.glyph || '(none)')}\n` +
          `Screen/route: ${context.route || '(unknown)'}\n` +
          `App: ${profile.name} — ${profile.description || ''}\n` +
          `Suggest a single best aria-label.`,
      },
    ],
    tool: {
      name: 'suggest_aria_label',
      description: 'Return the best aria-label for the element.',
      input_schema: {
        type: 'object',
        properties: {
          aria_label: { type: 'string', description: 'The suggested aria-label value (1-4 words).' },
        },
        required: ['aria_label'],
      },
    },
    tool_choice: { type: 'tool', name: 'suggest_aria_label' },
    max_tokens: 200,
    payload_types: ['trace'],
  };

  let json;
  try {
    json = await callGateway(url, body); // retry/backoff handled
  } catch (e) {
    // Persistent 429 → surface as rate-limited so the caller can halt; any other
    // failure (502 etc, exhausted) → return null so the caller falls back deterministically.
    if (/\b429\b/.test(e.message)) {
      const err = new Error('quota_exceeded');
      err.rateLimited = true;
      throw err;
    }
    return null;
  }
  const label = json?.output?.aria_label;
  return typeof label === 'string' && label.trim() ? label.trim() : null;
}

// ---------------------------------------------------------------------------
// 4. Collect findings across all traces.
// ---------------------------------------------------------------------------

function collectFromTrace({ file, trace }) {
  const out = [];
  const route0 = trace.entryPath || null;

  (trace.steps || []).forEach((step, stepIdx) => {
    const route = step.route || route0;

    // (a) Tier-1 locator debt from declared actions.
    (step.actions || []).forEach((a) => {
      const loc = a.locator;
      if (!loc) return;
      if (loc.debt === true || loc.strategy === 'unresolved') {
        out.push({
          source: 'tier1-locator-debt',
          trace: file,
          route,
          screen: step.intent || null,
          role: loc.role || a.target?.role || 'unknown',
          visibleText: a.target?.name || loc.value || loc.name || '',
          glyph: isGlyphOnly(a.target?.name) ? a.target?.name : null,
          target: a.target,
          strategy: loc.strategy,
          why:
            loc.strategy === 'unresolved'
              ? `Tier 1 could not resolve ${a.kind} ${a.target?.role || ''}/"${a.target?.name || ''}" by role+name — icon-only / no text / no ARIA. Recorded as locator debt.`
              : `Tier 1 had to degrade to strategy "${loc.strategy}" (below role+name) to reach ${a.target?.role || ''}/"${a.target?.name || ''}" — the element lacks a stable accessible name.`,
        });
      }
    });

    // (b) Interactive-but-unlabeled snapshot nodes (step + gating pre/post snaps).
    for (const str of stepSnapshotStrings(step)) {
      for (const f of scanSnapshotNodes(str)) {
        out.push({ ...f, trace: file, route, screen: step.intent || null, stepIdx });
      }
    }
  });

  return out;
}

// De-dupe: the same role-less node appears in many per-step snapshots. Key on
// role + visibleText + route so we report each distinct gap once.
function dedupe(findings) {
  const seen = new Map();
  for (const f of findings) {
    const key = `${f.source}|${f.role}|${f.visibleText}|${f.route}|${f.glyph || ''}`;
    if (!seen.has(key)) seen.set(key, f);
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// 5. Patch suggestion + report rendering.
// ---------------------------------------------------------------------------

function patchSuggestion(f, label) {
  // We don't have the app's frontend source, so we emit a precise element
  // signature + the exact attribute to add, framed as a unified-diff-style hint.
  const before = f.signature || `${f.role} "${f.visibleText || f.glyph || ''}"`;
  return [
    `Element signature (from a11y snapshot): ${before}`,
    `Suggested fix — add an accessible name:`,
    `    - <el …>${f.glyph || f.visibleText || ''}</el>`,
    `    + <el … aria-label="${label}">${f.glyph || f.visibleText || ''}</el>`,
    `(If the element renders a visible label elsewhere, prefer associating it via aria-labelledby.)`,
  ].join('\n');
}

function renderMarkdown(report) {
  const L = [];
  L.push(`# Accessibility Debt Report — ${report.profile}`);
  L.push('');
  L.push(`Generated: ${report.generatedAt}`);
  L.push(`Source traces: ${report.traces.join(', ') || '(none)'}`);
  L.push(`Label phrasing: ${report.labelSource}`);
  L.push(`Findings: ${report.findings.length}`);
  L.push('');
  if (!report.findings.length) {
    L.push('No interactive-but-unlabeled elements or Tier-1 a11y debt found in the available traces.');
    L.push('');
  } else {
    L.push('## Findings');
    L.push('');
    report.findings.forEach((f, i) => {
      L.push(`### ${i + 1}. ${f.role}${f.glyph ? ` "${f.glyph}"` : f.visibleText ? ` "${f.visibleText}"` : ''}`);
      L.push('');
      L.push(`- **Screen / route:** ${f.screen || '—'} ${f.route ? `(\`${f.route}\`)` : ''}`);
      L.push(`- **Detected via:** ${f.source}`);
      L.push(`- **Why it's a11y debt:** ${f.why}`);
      L.push(`- **Suggested \`aria-label\`:** \`${f.suggestedAriaLabel}\``);
      L.push('');
      L.push('**Patch suggestion:**');
      L.push('');
      L.push('```diff');
      L.push(f.patch);
      L.push('```');
      L.push('');
    });
    L.push('## Draft PR description');
    L.push('');
    L.push(report.prDescription);
    L.push('');
  }
  L.push('## Limits & follow-up');
  L.push('');
  L.push('- This agent works from a11y trace/snapshot data on disk; it does not run live discovery.');
  L.push('- It does NOT map findings to exact frontend source locations (no app source here), so patches');
  L.push('  are element-signature + attribute suggestions, not line-precise diffs.');
  L.push('- Opening a real Pull Request against the app repo is a documented follow-up: a future step would');
  L.push('  resolve each signature to its component/template file and open a draft PR via the host VCS.');
  return L.join('\n') + '\n';
}

function prDescription(report) {
  const n = report.findings.length;
  const L = [];
  L.push(`**chore(a11y): add missing aria-labels to ${n} interactive element(s) on ${report.profile}**`);
  L.push('');
  L.push('Automated accessibility remediation generated by the QA Evergreen Tier-4 a11y_remediator.');
  L.push('Each element below is interactive but has no accessible name, so assistive-technology users');
  L.push('cannot address it (and the locator strategy had to degrade or skip it).');
  L.push('');
  report.findings.forEach((f, i) => {
    L.push(`${i + 1}. ${f.screen || f.route || 'screen'}: ${f.role}${f.glyph ? ` "${f.glyph}"` : ''} → add \`aria-label="${f.suggestedAriaLabel}"\``);
  });
  L.push('');
  L.push('_Suggested labels were phrased by the model gateway (reasoning tier) where available, with a');
  L.push('deterministic fallback otherwise. Please review wording before merging._');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// 6. Main.
// ---------------------------------------------------------------------------

async function main() {
  console.log(`a11y_remediator: scanning workDir ${WORK_DIR} for profile "${profile.name}"`);
  const traces = loadTraces(WORK_DIR);
  if (!traces.length) {
    console.warn(`  no trace.*.json files in ${WORK_DIR} — nothing to scan.`);
  }

  let findings = [];
  for (const t of traces) findings.push(...collectFromTrace(t));
  findings = dedupe(findings);

  // Phrase aria-labels. Try the gateway; on the first error fall back for all
  // remaining findings (fail open to deterministic, per the platform rule).
  let useGateway = true;
  let usedGateway = false;
  let rateLimited = false;
  for (const f of findings) {
    let label = null;
    if (useGateway) {
      try {
        label = await gatewayLabel(f, f);
        if (label) usedGateway = true;
      } catch (e) {
        if (e.rateLimited) {
          rateLimited = true;
          console.warn('  gateway returned 429 (quota_exceeded) — stopping gateway calls, using deterministic labels.');
        } else {
          console.warn(`  gateway unavailable (${e.message}) — using deterministic labels.`);
        }
        useGateway = false;
      }
    }
    f.suggestedAriaLabel = label || deterministicLabel(f);
    f.patch = patchSuggestion(f, f.suggestedAriaLabel);
  }

  const labelSource =
    findings.length === 0
      ? 'n/a (no findings)'
      : usedGateway
        ? 'model gateway (reasoning tier), deterministic fallback per-finding'
        : 'deterministic (gateway unavailable — failed open)';

  const report = {
    profile: profile.name,
    generatedAt: new Date().toISOString(),
    workDir: WORK_DIR,
    traces: traces.map((t) => t.file),
    labelSource,
    rateLimited,
    findings,
  };
  report.prDescription = prDescription(report);

  const jsonPath = join(WORK_DIR, 'a11y-debt-report.json');
  const mdPath = join(WORK_DIR, 'a11y-debt-report.md');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(mdPath, renderMarkdown(report));

  console.log(`a11y_remediator: ${findings.length} finding(s).`);
  for (const f of findings) {
    console.log(`  [${f.source}] ${f.role}${f.glyph ? ` "${f.glyph}"` : f.visibleText ? ` "${f.visibleText}"` : ''} → aria-label="${f.suggestedAriaLabel}"`);
  }
  console.log(`a11y_remediator: wrote ${jsonPath}`);
  console.log(`a11y_remediator: wrote ${mdPath}`);
  if (rateLimited) {
    console.error('a11y_remediator: NOTE — gateway rate-limited; labels are deterministic fallbacks.');
  }
}

main().catch((e) => {
  console.error(`a11y_remediator: ${e.message}`);
  process.exit(1);
});
