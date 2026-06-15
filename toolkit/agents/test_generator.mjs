#!/usr/bin/env node
/**
 * test_generator.mjs — Layer 3 generation agent (plan §5 generator_agent / §20.3).
 *
 * Generic, PROFILE-DRIVEN. Compiles a DISCOVERED trace (from journey_discoverer)
 * into a runnable @playwright/test spec + Page Objects + feature, for ANY app —
 * deriving the locator facts from the trace's captured accessibility tree, NOT a
 * hardcoded contract. This is what makes the platform work on a real app like
 * OrangeHRM where no authoritative a11y contract exists.
 *
 * Model call goes through the gateway (reasoning tier, provider-agnostic, R1).
 * Output lands in profile.workDir so the profile-scoped Playwright run finds it.
 *
 * Usage: QA_PROFILE=orangehrm node test_generator.mjs [journeyId]
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadProfile } from '../profile.mjs';

const profile = loadProfile();
const journeyId = process.argv[2];
const journey = journeyId ? profile.journeys.find((j) => j.id === journeyId) : profile.journeys[0];
if (!journey) throw new Error(`no journey ${journeyId || '(first)'} in profile ${profile.name}`);

const WORK = profile.workDir;
const TRACE_PATH = join(WORK, `trace.${journey.id}.json`);

// --- distil the trace into compact, locator-relevant FACTS ------------------

function namedNodes(snap) {
  const refs = snap?.data?.refs ?? {};
  const seen = new Set();
  const out = [];
  for (const n of Object.values(refs)) {
    if (!n.name) continue;
    const key = `${n.role}:${n.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ role: n.role, name: n.name });
  }
  return out.slice(0, 30);
}

// Map a recorded Tier-1 locator descriptor → an explicit Playwright locator
// expression + a flag for whether the generator must emit a debt comment.
// Strategy ladder: role+name → name → text → placeholder → testid → unresolved.
function playwrightLocator(loc, target) {
  const role = loc?.role ?? target.role;
  const name = loc?.name ?? target.name;
  switch (loc?.strategy) {
    case 'name':
      // accessible name on a (possibly different) role
      return { expr: `getByRole('${role}', { name: ${q(name)} })`, debt: true };
    case 'text':
      // visible inner text — exact, role-scoped when we know the role
      return { expr: `getByText(${q(loc.value)}, { exact: true })`, debt: true };
    case 'placeholder':
      return { expr: `getByPlaceholder(${q(loc.value)})`, debt: true };
    case 'testid':
      return { expr: `getByTestId(${q(loc.value)})`, debt: true };
    case 'vlm': {
      // Tier 3: the VLM only IDENTIFIED the element; the locator below is the
      // DETERMINISTIC DOM signal the discoverer read for it (stable attribute or
      // exact text) — never a coordinate/nth/@ref. Preference baked into loc.attr.
      // CSS string-literal escaping for attribute values (handles ':' etc.).
      const cssStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      let expr;
      switch (loc.attr) {
        case 'data-evergreen': expr = `locator(${q(`[data-evergreen=${cssStr(loc.value)}]`)})`; break;
        case 'data-testid':    expr = `getByTestId(${q(loc.value)})`; break;
        case 'id':             expr = `locator(${q(`[id=${cssStr(loc.value)}]`)})`; break;
        case 'text':
        default:               expr = `getByText(${q(loc.value)}, { exact: true })`; break;
      }
      return { expr, debt: true, vlm: true };
    }
    case 'unresolved':
      return { expr: null, debt: true, unresolved: true };
    case 'role+name':
    default:
      return { expr: `getByRole('${role}', { name: ${q(name)} })`, debt: false };
  }
}

function q(s) { return JSON.stringify(String(s ?? '')); }

function factsFromTrace(trace) {
  const steps = trace.steps.map((s, i) => {
    const pre = s.causedStateChange?.preSnapshot ?? s.snapshot;
    return {
      n: i + 1,
      intent: s.intent,
      actions: (s.actions ?? []).map((a) => {
        const pl = playwrightLocator(a.locator, a.target);
        return {
          kind: a.kind,
          role: a.target.role,
          name: a.target.name,
          value: a.value,
          // Resolution facts the generator must obey verbatim:
          strategy: a.locator?.strategy ?? 'role+name',
          locator: pl.expr,           // exact Playwright expression to emit (null if unresolved)
          debt: pl.debt,              // emit a LOCATOR DEBT comment when true
          unresolved: pl.unresolved ?? false,
          vlm: pl.vlm ?? false,       // Tier-3 VLM-identified → special debt comment
          recommendedAriaLabel: a.locator?.recommendedAriaLabel ?? null,
        };
      }),
      visibleNodes: namedNodes(pre),
      causedStateChange: s.causedStateChange?.expectedAddedNodes ?? s.assertions ?? [],
    };
  });
  return { entryPath: trace.entryPath ?? '/', title: trace.title, role: trace.role, steps };
}

// --- gateway (reasoning tier) -----------------------------------------------

const TOOL = {
  name: 'emit_artifacts',
  description: 'Emit the compiled Playwright artifacts for the journey.',
  input_schema: {
    type: 'object',
    properties: {
      feature: { type: 'string', description: 'Gherkin .feature file contents.' },
      spec: { type: 'string', description: 'The *.spec.ts contents. Imports page objects from ./pages/*.' },
      pages: {
        type: 'array',
        description: 'One Page Object file per screen.',
        items: {
          type: 'object',
          properties: { filename: { type: 'string' }, contents: { type: 'string' } },
          required: ['filename', 'contents'],
        },
      },
    },
    required: ['feature', 'spec', 'pages'],
  },
};

function prompt(facts) {
  return `You are the platform's test generator. Compile this DISCOVERED journey trace into a Gherkin feature, Playwright Page Objects (one per screen), and a runnable @playwright/test spec. Call emit_artifacts exactly once.

App profile: ${profile.name}. Journey: "${facts.title}" (role ${facts.role}).
The spec runs with baseURL set by the Playwright config (the live app). Start with page.goto('${facts.entryPath}').

Discovered steps. Each action carries a Tier-1 RESILIENCE-LADDER resolution: a "strategy"
and an exact Playwright "locator" expression that you MUST use verbatim (call it on the page,
e.g. page.<locator>):
${JSON.stringify(facts.steps, null, 2)}

LOCATOR RULES (the platform already chose the most resilient strategy that resolves; honor it):
- For each action, build the Page Object method around its "locator" expression EXACTLY as given
  (getByRole / getByText / getByPlaceholder / getByTestId). Do not substitute a different strategy
  and never use CSS selectors, nth(), or coordinates.
- When an action has "debt": true, the strategy degraded below role+name. Emit a code comment
  immediately above that locator call, exactly:
      // LOCATOR DEBT (<strategy>): consider adding an aria-label
  using the action's "strategy" value. (No comment for role+name actions.)
- SPECIAL CASE — when an action has "vlm": true, it was located by Tier 3 (a vision model
  IDENTIFIED the icon-only element, then the platform mapped it to the DETERMINISTIC locator
  given in "locator"). Use that "locator" expression EXACTLY (it is a stable attribute/text
  locator — never a coordinate or nth). Emit this comment immediately above it instead:
      // LOCATOR DEBT (vlm): identified by vision — add an aria-label
- If an action has "unresolved": true, it could not be located even by Tier 3 (icon-only / no
  text / no aria / no stable attribute). Skip performing it but leave a comment:
      // LOCATOR DEBT (unresolved): no text/aria — needs VLM (Tier 3); skipped
- For the gating-step assertion, locate the causedStateChange node by role + accessible name
  (getByRole) as before.

HARD RULES:
- THE ASSERTION BAR: the spec MUST assert at least one node from the gating step's causedStateChange is visible AFTER the action (it was absent before). That is the state change the action caused — not merely a URL change.
- This is a LIVE remote app: use web-first assertions (await expect(locator).toBeVisible({ timeout: 15000 })) and reasonable waits. Do not assert exact transient content.
- Valid, runnable TypeScript. One Page Object class per screen. Use relative page.goto paths (baseURL comes from config).`;
}

async function generate(facts) {
  const res = await fetch(`${profile.gateway.url}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      repo: profile.name,
      tier: 'reasoning',
      messages: [{ role: 'user', content: prompt(facts) }],
      tool: TOOL,
      tool_choice: { type: 'tool', name: 'emit_artifacts' },
      max_tokens: 8000,
      payload_types: ['trace', 'a11y-tree'],
    }),
  });
  if (!res.ok) throw new Error(`gateway ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const data = await res.json();
  const o = data.output;
  if (!o?.feature || !o?.spec || !Array.isArray(o.pages)) throw new Error('gateway returned an incomplete artifact set');
  return { artifacts: o, meta: { provider: data.provider, model: data.model } };
}

// --- main -------------------------------------------------------------------

async function main() {
  let trace;
  try {
    trace = JSON.parse(readFileSync(TRACE_PATH, 'utf8'));
  } catch {
    throw new Error(`no trace at ${TRACE_PATH} — run journey_discoverer first (QA_PROFILE=${profile.name}).`);
  }

  const facts = factsFromTrace(trace);
  let result;
  try {
    result = await generate(facts);
  } catch (err) {
    console.error(`generate: gateway generation failed (${err.message}).`);
    console.error(`generate: start the model gateway at ${profile.gateway.url} (toolkit/gateway) and retry.`);
    process.exit(2);
  }

  // Per-journey subdir: each journey owns its spec + its OWN pages/ so
  // regenerating one journey can never clobber a sibling's page objects. The
  // spec's `./pages/X` imports resolve within this dir; @playwright/test still
  // resolves up the tree to the runner's node_modules.
  const OUT = join(WORK, journey.id);
  mkdirSync(join(OUT, 'pages'), { recursive: true });
  const featurePath = join(OUT, `${journey.id}.feature`);
  const specPath = join(OUT, `${journey.id}.spec.ts`);
  writeFileSync(featurePath, result.artifacts.feature.endsWith('\n') ? result.artifacts.feature : result.artifacts.feature + '\n');
  writeFileSync(specPath, result.artifacts.spec.endsWith('\n') ? result.artifacts.spec : result.artifacts.spec + '\n');
  const written = [];
  for (const p of result.artifacts.pages) {
    writeFileSync(join(OUT, 'pages', p.filename), p.contents.endsWith('\n') ? p.contents : p.contents + '\n');
    written.push(`pages/${p.filename}`);
  }

  console.log(`generate: ${profile.name}/${journey.id} via ${result.meta.provider}:${result.meta.model}`);
  console.log(`  wrote ${specPath}`);
  console.log(`  wrote ${featurePath}`);
  for (const w of written) console.log(`  wrote ${join(OUT, w)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
