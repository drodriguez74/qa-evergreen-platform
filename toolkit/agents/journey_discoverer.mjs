#!/usr/bin/env node
/**
 * journey_discoverer.mjs — Layer 2 discovery agent (plan §5 / §20).
 *
 * Generic, PROFILE-DRIVEN journey discovery for any target app. Reads the active
 * profile's target + a journey definition and drives the `agent-browser` CLI
 * against the live site, resolving every action target (role + accessible name)
 * to a live @ref through the accessibility tree — so it is framework- and
 * app-agnostic by construction. For the gating step it captures pre/post a11y
 * snapshots so the compiler can assert the CAUSED state change (assertion-bar).
 *
 * Output: a trace at runs/<profile>/trace.<journeyId>.json — profile-scoped, so
 * many apps coexist. Unlike the steel-thread's fundflow discover.mjs (which walks
 * an authoritative contract on localhost), this works on a real external app with
 * NO contract: the discovered a11y tree IS the surface.
 *
 * Usage: node journey_discoverer.mjs            # first journey of QA_PROFILE
 *        QA_PROFILE=orangehrm node journey_discoverer.mjs [journeyId]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProfile } from '../profile.mjs';

const profile = loadProfile();
const journeyId = process.argv[2];
const journey = journeyId
  ? profile.journeys.find((j) => j.id === journeyId)
  : profile.journeys[0];
if (!journey) throw new Error(`no journey ${journeyId || '(first)'} in profile ${profile.name}`);
if (!journey.steps) throw new Error(`journey ${journey.id} has no steps (profile-driven discovery needs declared steps)`);

const target = profile.targets[0];
if (!target) throw new Error(`profile ${profile.name} has no targets`);
// hostname (not host) — agent-browser --allowed-domains wants the bare host with
// NO port (it rejects e.g. "localhost:5173"). Portless hosts are unaffected.
const HOST = new URL(target.baseURL).hostname;
const SESSION = `disc-${profile.name}`;
const OUT_DIR = profile.workDir;
const TRACE_PATH = join(OUT_DIR, `trace.${journey.id}.json`);

// --- agent-browser helpers (login shell so PATH/nvm resolve it) -------------

function ab(args, { json = false } = {}) {
  const full = ['agent-browser', ...args, '--session', SESSION];
  if (json) full.push('--json');
  const cmd = full.map(shellQuote).join(' ');
  const res = spawnSync('bash', ['-lc', cmd], { encoding: 'utf8' });
  return { ok: res.status === 0, status: res.status, stdout: (res.stdout || '').trim(), stderr: (res.stderr || '').trim(), error: res.error };
}
function shellQuote(s) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`;
}
function snapshot() {
  const res = ab(['snapshot', '-i'], { json: true });
  if (!res.ok) return { error: res.stderr || 'snapshot failed' };
  try { return JSON.parse(res.stdout); } catch { return { raw: res.stdout }; }
}

// Run JS in the live page and return its result (or null on failure). Uses
// --base64 to dodge shell-quoting of arbitrary JS.
function evalJs(js) {
  const b64 = Buffer.from(js, 'utf8').toString('base64');
  const res = ab(['eval', '-b', b64], { json: true });
  if (!res.ok) return null;
  try {
    const parsed = JSON.parse(res.stdout);
    return parsed?.success ? parsed.data?.result : null;
  } catch { return null; }
}

// --- Tier-1 resilience ladder ----------------------------------------------
//
// The structured `data.refs` only carries {role, name}. Text-only and
// placeholder-only controls (legacy apps with poor ARIA) surface with an EMPTY
// accessible name there, but their VISIBLE text is quoted inline in the
// `data.snapshot` YAML string, e.g.:
//   - paragraph "Forgot your password?" [ref=e3] clickable [cursor:pointer]
//   - textbox "Username" [ref=e9]
// So we parse that string to recover per-ref displayed text and enrich the
// ref table. agent-browser's -i snapshot does NOT expose a distinct
// `placeholder` attribute; for inputs whose accessible name derives from a
// placeholder, that placeholder text shows up as the quoted text/name — we
// resolve those via the `placeholder` tier honestly (see resolveTarget).

// Parse `- <role> "quoted text" [ref=eN] ...trailing...` lines.
function parseSnapshotText(snap) {
  const out = {}; // ref -> { role, text, isInput }
  const s = snap?.data?.snapshot;
  if (typeof s !== 'string') return out;
  const lineRe = /^\s*-\s+(\S+)(?:\s+"((?:[^"\\]|\\.)*)")?[^\n]*?\[ref=(e\d+)\]([^\n]*)$/;
  for (const line of s.split('\n')) {
    const m = line.match(lineRe);
    if (!m) continue;
    const role = m[1];
    const text = m[2] != null ? m[2].replace(/\\"/g, '"') : '';
    const ref = m[3];
    const isInput = role === 'textbox' || role === 'combobox' || role === 'searchbox';
    out[ref] = { role, text, isInput };
  }
  return out;
}

// Synthetic positional names that profile_init emits for unlabelled textboxes in
// poor-accessibility apps (it can't read a real accessible name, so it assigns
// "Username"/"Password" by position). These let the nth-of-role tier map such a
// synthetic name back to the ordinal it stands for.
const POSITIONAL_NAMES = ['username', 'user', 'email', 'login', 'account', 'phone'];
const POSITIONAL_PASS = ['password', 'passcode', 'pin'];

// Map a synthetic profile_init name to an ordinal among same-role elements:
//   textbox/searchbox "Username"/user/email/login → nth 0
//   textbox/searchbox "Password"/passcode/pin     → nth 1
// Returns null when the name carries no positional hint (then nth-of-role can't apply).
function inferNthFromName(name, role, refs) {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  if (role === 'textbox' || role === 'searchbox') {
    if (POSITIONAL_NAMES.some((p) => lower.includes(p))) return 0;
    if (POSITIONAL_PASS.some((p) => lower.includes(p))) return 1;
  }
  return null;
}

// Resolve a target to { ref, locator } via the resilience-ranked ladder.
// locator = { strategy, role, name, value, debt }.
// Strategies (most → least resilient):
//   role+name → name → text → placeholder → nth-of-role → testid/id → unresolved
function resolveTarget(t, snap) {
  const refs = snap?.data?.refs ?? {};
  const text = parseSnapshotText(snap);
  const want = (t.name ?? '').trim();

  // 1. role + name (preferred; identical to legacy behaviour). Trim both sides:
  //    some apps surface a leading/trailing-padded accessible name (e.g. " Login ")
  //    that would otherwise miss an exact, untrimmed comparison.
  if (t.role && want) {
    for (const [ref, node] of Object.entries(refs)) {
      if (node.role === t.role && (node.name ?? '').trim() === want) {
        return { ref, locator: { strategy: 'role+name', role: t.role, name: want, value: null, debt: false } };
      }
    }
  }

  // 2. name on ANY role (accessible name drifted off the expected role)
  if (want) {
    for (const [ref, node] of Object.entries(refs)) {
      if ((node.name ?? '').trim() === want) {
        return { ref, locator: { strategy: 'name', role: node.role, name: want, value: null, debt: true } };
      }
    }
  }

  // The remaining tiers match against VISIBLE text recovered from the snapshot
  // string. We match on the expected name as the text value (the journey
  // declares the human-visible label as `name`).
  if (want) {
    // 3. text — visible inner text on a NON-input element → getByText exact.
    //    Prefer a ref whose role matches (lets the generator scope the locator).
    let textHit = null, textHitAny = null;
    for (const [ref, info] of Object.entries(text)) {
      if (info.isInput) continue;
      if (info.text !== want) continue;
      if (!textHitAny) textHitAny = ref;
      if (t.role && info.role === t.role) { textHit = ref; break; }
    }
    const tRef = textHit || textHitAny;
    if (tRef) {
      const role = text[tRef].role;
      return { ref: tRef, locator: { strategy: 'text', role, name: null, value: want, debt: true } };
    }

    // 4. placeholder — an input whose displayed/placeholder text equals `want`.
    //    -i exposes no separate placeholder field, so we treat an input's quoted
    //    text as its placeholder when the structured accessible name is empty.
    for (const [ref, info] of Object.entries(text)) {
      if (!info.isInput) continue;
      if (info.text !== want) continue;
      const accName = refs[ref]?.name ?? '';
      if (accName) continue; // had a real accessible name → tier 1/2 would've caught it
      return { ref, locator: { strategy: 'placeholder', role: info.role, name: null, value: want, debt: true } };
    }
  }

  // 4b. nth-of-role — multiple elements share a role with NO usable accessible
  //     name (poor-ARIA apps: unlabelled textboxes). Resolve by ordinal position.
  //     The journey carries a SYNTHETIC name (e.g. "Username"/"Password" from
  //     profile_init's positional fallback); inferNthFromName maps it to an ordinal.
  if (t.role) {
    const nth = inferNthFromName(want, t.role, refs);
    if (nth != null) {
      // Only degrade to position when the role genuinely lacks unique names:
      // collect same-role refs in document order (refs keys are insertion-ordered).
      const sameRole = Object.entries(refs).filter(([, node]) => node.role === t.role);
      if (sameRole.length > 1 && nth < sameRole.length) {
        const [ref] = sameRole[nth];
        return { ref, locator: { strategy: 'nth-of-role', role: t.role, name: want || null, value: null, nth, debt: true } };
      }
    }
  }

  // 5. testid / stable attribute — only if the snapshot exposes one. agent-browser's
  //    -i snapshot does NOT surface data-testid/id, so this tier is structurally
  //    a no-op here; declared so the generator/schema cover it when a future
  //    snapshot mode (e.g. eval-based attribute capture) provides it.
  if (t.testid) {
    return { ref: null, locator: { strategy: 'testid', role: t.role ?? null, name: null, value: t.testid, debt: true } };
  }

  // 6. unresolved — Tier 1 cannot resolve this (icon-only / bare-glyph: no text,
  //    no aria). Do NOT invent a CSS-nth/coordinate locator. Caller hands this to
  //    Tier 3 (VLM) before finally recording it as unresolved debt.
  return { ref: null, locator: { strategy: 'unresolved', role: t.role ?? null, name: want || null, value: null, debt: true } };
}

// --- Tier 3: VLM identification → DETERMINISTIC locator ---------------------
//
// Runs ONLY when Tier 1's whole ladder fails (role+name/name/text/placeholder/
// testid all miss → 'unresolved'). It is discovery-time only — cost, latency,
// and nondeterminism keep it OFF the happy path and OUT of the test of record.
//
// Principle: the vision model only IDENTIFIES *which* element matches the
// journey's intended (role/name). It NEVER produces the locator. We:
//   1. enumerate icon-only / bare-glyph candidate elements from the live DOM via
//      `eval` (leaf elements, short visible text, NO accessible name) — each with
//      a stable index and the STABLE DOM signals we can read directly
//      (data-evergreen / data-testid / id / exact textContent);
//   2. screenshot the page, send image + the candidate list to the gateway
//      (reasoning tier, multimodal) and ask it to PICK the matching index;
//   3. map the picked candidate to a DETERMINISTIC locator from the DOM data we
//      already read (NOT from anything the model typed): stable attribute first,
//      else exact textContent → getByText; else give up → unresolved + a
//      recommendedAriaLabel handoff to Tier 4.
//
// HARD RULE: never emit pixel coords / CSS-nth / @ref into the spec. The boxes we
// pass the model are for VISUAL cross-reference only and are discarded.

const VLM_CAND_JS = `(() => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  };
  const out = []; let i = 0;
  for (const el of document.querySelectorAll('*')) {
    if (el.getAttribute('aria-label')) continue;   // has a name → Tier 1 territory
    if (el.children.length > 0) continue;           // leaf-ish only (skip containers)
    const text = (el.textContent || '').trim();
    if (!text || text.length > 4) continue;         // icon-only / bare-glyph
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    out.push({
      i: i++,
      tag: el.tagName.toLowerCase(),
      text,
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      attrs: {
        'data-evergreen': el.getAttribute('data-evergreen') || null,
        'data-testid': el.getAttribute('data-testid') || null,
        id: el.id || null,
      },
    });
    if (i >= 40) break;
  }
  return out;
})()`;

// Ask the multimodal gateway which candidate index matches the intended target.
async function vlmPick(intended, candidates, pngPath) {
  let b64;
  try { b64 = readFileSync(pngPath).toString('base64'); }
  catch { return { error: 'screenshot unreadable' }; }
  // The model sees the candidates WITHOUT their stable attrs — it must not be
  // tempted to echo a locator. It only returns an index we resolve ourselves.
  const slim = candidates.map((c) => ({ i: c.i, tag: c.tag, text: c.text, box: c.box }));
  const text = `You are locating ONE UI element in a screenshot for a deterministic test-automation tool.
INTENDED TARGET (semantic): role="${intended.role ?? '(any)'}", name/purpose="${intended.name ?? ''}".
Below are icon-only / short-text candidate elements detected in the DOM. Each has an index "i", tag, exact visible text, and a pixel box for VISUAL cross-reference with the screenshot ONLY:
${JSON.stringify(slim)}
Use the screenshot to understand each candidate visually, then choose the SINGLE candidate index that best matches the intended target. Never invent coordinates or selectors. Reply with STRICT JSON only:
{"matchIndex": <i or null>, "confidence": <0..1>, "reason": "<short>", "recommendedAriaLabel": "<the aria-label this element should have, e.g. the intended name>"}`;
  let res;
  try {
    res = await fetch(`${profile.gateway.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repo: profile.name,
        tier: 'reasoning',
        max_tokens: 400,
        messages: [{ role: 'user', content: [
          { type: 'text', text },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
        ] }],
        payload_types: ['screenshot', 'a11y-tree'],
      }),
    });
  } catch (e) { return { error: `gateway unreachable: ${e.message}` }; }
  if (!res.ok) return { error: `gateway ${res.status}` };
  let data;
  try { data = await res.json(); } catch { return { error: 'gateway non-JSON' }; }
  const raw = typeof data.output === 'string' ? data.output : JSON.stringify(data.output ?? '');
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { error: 'model returned no JSON' };
  try { return { pick: JSON.parse(m[0]) }; } catch { return { error: 'model JSON unparseable' }; }
}

// Tier 3 entry. Returns { ref, locator } — locator.strategy is 'vlm' (mapped to
// a stable attribute/text locator) or 'unresolved' (with recommendedAriaLabel).
async function resolveTargetVLM(t) {
  const want = (t.name ?? '').trim();
  const fallback = (recommendedAriaLabel) => ({
    ref: null,
    locator: { strategy: 'unresolved', role: t.role ?? null, name: want || null, value: null, debt: true, ...(recommendedAriaLabel ? { recommendedAriaLabel } : {}) },
  });

  const candidates = evalJs(VLM_CAND_JS);
  if (!Array.isArray(candidates) || candidates.length === 0) {
    console.warn('    VLM: no icon-only candidates in DOM — staying unresolved.');
    return fallback();
  }

  const pngPath = join(tmpdir(), `evergreen-vlm-${SESSION}-${Date.now()}.png`);
  const shot = ab(['screenshot', pngPath]);
  if (!shot.ok) {
    console.warn(`    VLM: screenshot failed (${shot.stderr || 'unknown'}) — staying unresolved.`);
    return fallback();
  }

  let picked;
  try {
    const { pick, error } = await vlmPick({ role: t.role, name: want }, candidates, pngPath);
    if (error || !pick || pick.matchIndex == null) {
      console.warn(`    VLM: no match (${error || pick?.reason || 'none'}) — staying unresolved.`);
      return fallback(pick?.recommendedAriaLabel || want || undefined);
    }
    picked = { ...pick, cand: candidates.find((c) => c.i === pick.matchIndex) };
  } finally {
    try { rmSync(pngPath, { force: true }); } catch { /* best-effort */ }
  }

  const cand = picked.cand;
  if (!cand) {
    console.warn('    VLM: returned an out-of-range index — staying unresolved.');
    return fallback(picked.recommendedAriaLabel || want || undefined);
  }
  const recommendedAriaLabel = picked.recommendedAriaLabel || want || undefined;
  console.warn(`    VLM identified candidate #${cand.i} ("${cand.text}", <${cand.tag}>) as the target (confidence ${picked.confidence ?? '?'}): ${picked.reason ?? ''}`);

  // Map to a DETERMINISTIC locator from DOM data we read ourselves — never the
  // model's text. Preference: stable attr → exact textContent → unresolved.
  const a = cand.attrs || {};
  if (a['data-evergreen']) {
    return { ref: null, locator: { strategy: 'vlm', role: t.role ?? null, name: want || null, value: a['data-evergreen'], attr: 'data-evergreen', debt: true, recommendedAriaLabel } };
  }
  if (a['data-testid']) {
    return { ref: null, locator: { strategy: 'vlm', role: t.role ?? null, name: want || null, value: a['data-testid'], attr: 'data-testid', debt: true, recommendedAriaLabel } };
  }
  if (a.id) {
    return { ref: null, locator: { strategy: 'vlm', role: t.role ?? null, name: want || null, value: a.id, attr: 'id', debt: true, recommendedAriaLabel } };
  }
  if (cand.text) {
    // Byte-exact textContent we read from the DOM (NOT the model's transcription).
    return { ref: null, locator: { strategy: 'vlm', role: t.role ?? null, name: want || null, value: cand.text, attr: 'text', debt: true, recommendedAriaLabel } };
  }
  // Identified but no stable DOM signal at all → Tier 4 handoff.
  console.warn('    VLM: identified element has no stable attribute or text — unresolved, recommending an aria-label.');
  return fallback(recommendedAriaLabel);
}

// Resolve a target to a live @ref via the resilience ladder, then act. Returns
// { ok, stderr?, locator } where locator is the recorded Tier-1 descriptor.
// role+name still uses agent-browser's `find role <r> click --name <n>` fast
// path for clicks (backward-compatible); lower tiers act by the resolved @ref.
async function performAction(action) {
  const { kind, target: t, value } = action;
  const snap = snapshot();
  let { ref, locator } = resolveTarget(t, snap);

  // Tier 3: when Tier 1's whole ladder fails, ask the VLM to identify the
  // element and map it to a DETERMINISTIC locator before giving up.
  if (locator.strategy === 'unresolved') {
    console.warn(`    Tier 1 exhausted for ${t.role}/"${t.name}" — invoking Tier 3 (VLM).`);
    const vlm = await resolveTargetVLM(t);
    locator = vlm.locator;
    ref = vlm.ref;
  }

  const fail = (stderr) => ({ ok: false, stderr, locator });

  // For a VLM-resolved locator we act via the chosen STABLE signal (never a
  // coordinate / @ref): a stable attribute → CSS attr selector; else exact text.
  const vlmSelector = () => {
    if (locator.attr === 'data-evergreen') return `[data-evergreen="${locator.value}"]`;
    if (locator.attr === 'data-testid') return `[data-testid="${locator.value}"]`;
    if (locator.attr === 'id') return `#${locator.value}`;
    return null; // 'text' → handled via find below
  };

  switch (kind) {
    case 'fill': {
      if (locator.strategy === 'vlm') {
        const sel = vlmSelector();
        if (sel) return { ...ab(['fill', sel, value]), locator };
        if (locator.attr === 'text') return { ...ab(['find', 'text', locator.value, 'fill', value]), locator };
        return fail(`vlm locator has no stable signal for ${t.role}/"${t.name}"`);
      }
      if (!ref) return fail(`no ref for ${t.role}/"${t.name}" (strategy=${locator.strategy})`);
      return { ...ab(['fill', `@${ref}`, value]), locator };
    }
    case 'select': {
      if (locator.strategy === 'vlm') {
        const sel = vlmSelector();
        if (sel) return { ...ab(['select', sel, value]), locator };
        return fail(`vlm locator has no stable selector for select on ${t.role}/"${t.name}"`);
      }
      if (!ref) return fail(`no ref for ${t.role}/"${t.name}" (strategy=${locator.strategy})`);
      return { ...ab(['select', `@${ref}`, value]), locator };
    }
    case 'click': {
      // Backward-compatible fast path: identical output to before for role+name.
      if (locator.strategy === 'role+name') {
        const byRole = ab(['find', 'role', t.role, 'click', '--name', t.name]);
        if (byRole.ok) return { ...byRole, locator };
      }
      if (locator.strategy === 'vlm') {
        const sel = vlmSelector();
        if (sel) return { ...ab(['click', sel]), locator };
        if (locator.attr === 'text') return { ...ab(['find', 'text', locator.value, 'click']), locator };
        return fail(`vlm locator has no stable signal for ${t.role}/"${t.name}"`);
      }
      if (!ref) return fail(`no ref for ${t.role}/"${t.name}" (strategy=${locator.strategy})`);
      return { ...ab(['click', `@${ref}`]), locator };
    }
    default:
      return fail(`unknown action kind: ${kind}`);
  }
}

// --- discover ---------------------------------------------------------------

async function discover() {
  const url = target.baseURL.replace(/\/$/, '') + (journey.entryPath || '/');
  // Session-mode auth (SSO/MFA): load the captured state so the crawl starts
  // authenticated. agent-browser --state reads the same JSON Playwright wrote.
  const openArgs = ['open', url, '--allowed-domains', HOST];
  if (profile.auth?.mode === 'session' && existsSync(profile.auth.statePath)) {
    openArgs.push('--state', profile.auth.statePath);
  }
  const opened = ab(openArgs);
  if (!opened.ok) throw new Error(`could not open ${url} (${opened.stderr || opened.error?.message})`);

  ab(['wait', '1500']);
  const steps = [];
  for (const step of journey.steps) {
    ab(['wait', '700']);
    const pre = snapshot();
    const locators = [];
    for (const action of step.actions || []) {
      const res = await performAction(action);
      locators.push(res.locator ?? null);
      if (res.locator) {
        if (res.locator.debt) {
          const via = res.locator.strategy === 'vlm' ? ` (VLM-identified → ${res.locator.attr} locator)` : '';
          console.warn(`  LOCATOR DEBT [${res.locator.strategy}] ${action.kind} ${action.target.role}/"${action.target.name}" — degraded below role+name${via}`);
        }
        if (res.locator.strategy === 'unresolved') {
          // Tier 1 cannot resolve this (icon-only / no text / no aria). Mark it
          // as debt and continue — do NOT crash and do NOT invent a CSS/coord
          // locator. Resolving it is Tier 3 (VLM)'s job.
          console.warn(`  UNRESOLVED ${action.kind} ${action.target.role}/"${action.target.name}" — recorded as locator debt (Tier 3 / VLM territory).`);
          continue;
        }
      }
      if (!res.ok) throw new Error(`step "${step.intent}" ${action.kind} ${action.target.role}/"${action.target.name}" failed: ${res.stderr}`);
    }
    ab(['wait', '1500']);
    const post = (step.actions || []).length ? snapshot() : pre;

    // Attach the resolved Tier-1 locator descriptor onto each action so the
    // generator compiles the right Playwright locator + emits debt comments.
    const actionsWithLocators = (step.actions ?? []).map((a, i) => ({ ...a, locator: locators[i] ?? null }));
    const record = { intent: step.intent, route: step.route ?? null, assertions: step.assertions ?? [], actions: actionsWithLocators, snapshot: post };
    if (step.gating) {
      record.causedStateChange = {
        note: 'Diff of post-action vs pre-action snapshot for the gating step (assertion-bar).',
        preSnapshot: pre,
        postSnapshot: post,
        expectedAddedNodes: step.causedStateChange ?? [],
      };
    }
    steps.push(record);
  }

  return {
    journeyId: journey.id,
    role: journey.role ?? null,
    title: journey.title ?? journey.id,
    source: 'agent-browser',
    profile: profile.name,
    targetBaseUrl: target.baseURL,
    entryPath: journey.entryPath ?? '/',
    contract: profile.contract ?? null, // null for real apps — surface is discovered
    capturedAt: new Date().toISOString(),
    steps,
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  let trace;
  try {
    trace = await discover();
    console.log(`discover: live agent-browser run succeeded for ${profile.name}/${journey.id}.`);
  } finally {
    const closed = ab(['close', '--all']);
    if (!closed.ok) console.error(`discover: note — close --all returned: ${closed.stderr}`);
  }
  writeFileSync(TRACE_PATH, JSON.stringify(trace, null, 2) + '\n');
  console.log(`discover: wrote ${TRACE_PATH}`);
  // Quick caused-state-change confirmation for the operator.
  const gate = trace.steps.find((s) => s.causedStateChange);
  if (gate) {
    const post = gate.causedStateChange.postSnapshot?.data?.refs ?? {};
    for (const want of gate.causedStateChange.expectedAddedNodes) {
      const present = Object.values(post).some((n) => n.role === want.role && n.name === want.name);
      console.log(`  caused-state-change ${want.role} "${want.name}": ${present ? 'PRESENT ✓' : 'MISSING ✗'}`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
