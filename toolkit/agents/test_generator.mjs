#!/usr/bin/env node
/**
 * test_generator.mjs — Layer 3 generation agent (plan §5 generator_agent / §20.3).
 *
 * Generic, PROFILE-DRIVEN. Compiles a DISCOVERED trace (from journey_discoverer
 * OR intent_to_journey) into a runnable **Cucumber-JS** suite — a Gherkin
 * `.feature`, step definitions, and Page Objects — for ANY app, deriving the
 * locator facts from the trace's captured accessibility tree, NOT a hardcoded
 * contract. This is what makes the platform work on a real app like OrangeHRM
 * where no authoritative a11y contract exists.
 *
 * WHY Cucumber (not raw @playwright/test): QA Engineers work in BDD in their BAU
 * — feature files + step definitions + Page Objects — not bare Playwright specs.
 * See the session audit "Cucumber-JS Integration" section.
 *
 * OUTPUT LAYOUT — standard FLAT Cucumber layout (NOT per-journey subdirs):
 *   <cucumberRoot>/features/<journeyId>.feature
 *   <cucumberRoot>/steps/<journeyId>.steps.ts
 *   <cucumberRoot>/pages/<ClassName>.ts      (reusable; overwrites same filename)
 *   <cucumberRoot>/support/world.ts          (scaffolded once if absent)
 *   <cucumberRoot>/support/hooks.ts          (scaffolded once if absent)
 *   <cucumberRoot>/cucumber.js               (scaffolded once if absent)
 * Shared World/hooks/config live under support/ — one source of truth.
 *
 * The cucumberRoot defaults to steel-thread/thread (the runner home that owns
 * @cucumber/cucumber + tsx). Override with QA_CUCUMBER_ROOT.
 *
 * Model call goes through the gateway (reasoning tier, provider-agnostic, R1).
 *
 * Usage: QA_PROFILE=orangehrm node test_generator.mjs [journeyId|intentId]
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProfile } from '../profile.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

const profile = loadProfile();
const journeyId = process.argv[2];

// Resolve the requested id: a declared journey first, then fall back to an
// intent (scaffold lane — intent_to_journey produces a trace for an intent id
// that may not exist in journeys[]). Synthesise a minimal journey for context.
let journey = journeyId ? profile.journeys.find((j) => j.id === journeyId) : profile.journeys[0];
if (!journey && journeyId) {
  const intent = (profile.raw?.intents || []).find((it) => it.id === journeyId);
  if (intent) {
    journey = { id: intent.id, role: 'discovered', title: intent.description, entryPath: intent.entryPath || '/' };
  }
}
if (!journey) throw new Error(`no journey or intent "${journeyId || '(first)'}" in profile ${profile.name}`);

const WORK = profile.workDir;
const TRACE_PATH = join(WORK, `trace.${journey.id}.json`);

// Where the flat Cucumber project lives. The runner home (steel-thread/thread)
// owns @cucumber/cucumber + tsx by default; a directory-profile would point this
// at profiles/<name>/. Always a FLAT layout — features/, steps/, pages/, support/.
const CUCUMBER_ROOT =
  process.env.QA_CUCUMBER_ROOT
    ? resolve(process.cwd(), process.env.QA_CUCUMBER_ROOT)
    : resolve(REPO_ROOT, 'steel-thread', 'thread');

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

// Map a recorded locator descriptor → an explicit Playwright locator expression
// + a flag for whether the generator must emit a debt comment.
// Strategy ladder: role+name → name → text → placeholder → nth-of-role → testid
//                  → vlm → unresolved.
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
    case 'nth-of-role':
      // Tier 4b: multiple same-role elements with NO accessible name — resolve by
      // ordinal position. This is the poor-ARIA fallback (e.g. unlabelled login
      // textboxes). It is deterministic (no coordinates) but role-only, so it is
      // debt: prefer adding an aria-label.
      return { expr: `getByRole('${role}').nth(${loc.nth ?? 0})`, debt: true, nthOfRole: true };
    case 'testid':
      return { expr: `getByTestId(${q(loc.value)})`, debt: true };
    case 'vlm': {
      // Tier 3: the VLM only IDENTIFIED the element; the locator below is the
      // DETERMINISTIC DOM signal the discoverer read for it (stable attribute or
      // exact text) — never a coordinate/nth/@ref. Preference baked into loc.attr.
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
          nthOfRole: pl.nthOfRole ?? false,
          recommendedAriaLabel: a.locator?.recommendedAriaLabel ?? null,
        };
      }),
      visibleNodes: namedNodes(pre),
      causedStateChange: s.causedStateChange?.expectedAddedNodes ?? s.assertions ?? [],
    };
  });
  // baseURL: prefer the trace's recorded target; else the profile's first target.
  const baseURL = trace.targetBaseUrl || profile.targets?.[0]?.baseURL || '';
  return { id: trace.journeyId ?? journey.id, entryPath: trace.entryPath ?? '/', title: trace.title, role: trace.role, baseURL, steps };
}

// --- gateway (reasoning tier) -----------------------------------------------

const TOOL = {
  name: 'emit_cucumber',
  description: 'Emit the compiled Cucumber-JS artifacts (feature + step defs + Page Objects) for the journey.',
  input_schema: {
    type: 'object',
    properties: {
      feature: { type: 'string', description: 'Gherkin .feature file contents (one Feature, one Scenario).' },
      steps: { type: 'string', description: 'The <journeyId>.steps.ts step-definition file. Imports Page Objects from ../pages/*.js and the World from ../support/world.js.' },
      pages: {
        type: 'array',
        description: 'One Page Object class file per screen. Reusable across journeys.',
        items: {
          type: 'object',
          properties: { filename: { type: 'string' }, contents: { type: 'string' } },
          required: ['filename', 'contents'],
        },
      },
    },
    required: ['feature', 'steps', 'pages'],
  },
};

function prompt(facts) {
  return `You are the platform's test generator. Compile this DISCOVERED journey trace into a **Cucumber-JS** suite: a Gherkin feature, step definitions, and Playwright Page Objects (one per screen). Call emit_cucumber exactly once.

App profile: ${profile.name}. Journey id: "${facts.id}". Title: "${facts.title}" (role ${facts.role}).
This is the STANDARD FLAT Cucumber layout. Your files land here:
  - feature  → features/${facts.id}.feature
  - steps    → steps/${facts.id}.steps.ts
  - pages    → pages/<ClassName>.ts   (reusable; one class per screen)

The Page Objects, steps, and World all run via Cucumber-JS + Playwright. The World
(support/world.ts) exposes \`this.page\` (a Playwright Page) and \`this.baseURL\`. Step
definitions are typed \`function (this: World, ...)\` and import the World as:
    import { World } from '../support/world.js';
Import Page Objects with a \`.js\` extension (ESM/tsx): import { LoginPage } from '../pages/LoginPage.js';

ENTRY: the first step must navigate to the entry path. Build the absolute URL from the World:
    await this.page.goto(new URL('${facts.entryPath}', this.baseURL).toString());

Discovered steps. Each action carries a RESILIENCE-LADDER resolution: a "strategy"
and an exact Playwright "locator" expression that you MUST use verbatim (call it on the
Page Object's page, e.g. this.page.<locator>):
${JSON.stringify(facts.steps, null, 2)}

LOCATOR RULES (the platform already chose the most resilient strategy that resolves; honor it):
- For each action, build the Page Object method around its "locator" expression EXACTLY as given
  (getByRole / getByText / getByPlaceholder / getByTestId / getByRole(...).nth(n)). Do NOT
  substitute a different strategy and never use CSS selectors or coordinates.
- When an action has "debt": true, the strategy degraded below role+name. Emit a code comment
  on the line immediately above that locator assignment, exactly:
      // LOCATOR DEBT (<strategy>): consider adding an aria-label
  using the action's "strategy" value. (No comment for role+name actions.)
- SPECIAL CASE — "nthOfRole": true → the action resolved by ordinal position because multiple
  same-role elements share no accessible name (e.g. unlabelled login inputs). The "locator" is
  getByRole('<role>').nth(<n>). Use it EXACTLY and emit this comment immediately above it:
      // LOCATOR DEBT (nth-of-role): consider adding an aria-label
- SPECIAL CASE — "vlm": true → located by a vision model, mapped to the DETERMINISTIC locator in
  "locator". Use it EXACTLY and emit immediately above it:
      // LOCATOR DEBT (vlm): identified by vision — add an aria-label
- "unresolved": true → could not be located. Skip it, leave a comment:
      // LOCATOR DEBT (unresolved): no text/aria — needs VLM (Tier 3); skipped
- For the gating-step assertion, locate the causedStateChange node by role + accessible name
  (getByRole) and assert it is visible.

POST-LOGIN HYDRATION WAIT (§11): if a step performs a login/submit that causes a navigation
(its causedStateChange brings in new nodes), the Page Object method that performs that submit
MUST, immediately AFTER the click, await visibility of one stable post-login node so navigation
clicks never race page hydration:
    await expect(this.page.<causedStateChange locator>).toBeVisible({ timeout: 15000 });
Use the gating step's first causedStateChange node (role+name) for this wait.

HARD RULES:
- THE ASSERTION BAR: the scenario MUST assert (in a Then step) that at least one node from the
  gating step's causedStateChange is visible AFTER the action (absent before). That is the state
  change the action caused — not merely a URL change.
- This is a LIVE remote app: use web-first assertions (await expect(locator).toBeVisible({ timeout: 15000 }))
  and reasonable waits. Do not assert exact transient content.
- The feature has ONE Feature and ONE Scenario. The Gherkin step text must EXACTLY match the
  Given/When/Then strings your step file registers (no Cucumber "undefined step" errors).
- The steps file registers ALL steps used by this feature (this is a single-journey suite — do
  not assume shared login/nav steps exist elsewhere). Import { Given, When, Then } from '@cucumber/cucumber'
  and { expect } from '@playwright/test'.
- Valid, runnable TypeScript. One Page Object class per screen.`;
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
      tool_choice: { type: 'tool', name: 'emit_cucumber' },
      max_tokens: 8000,
      payload_types: ['trace', 'a11y-tree'],
    }),
  });
  if (!res.ok) throw new Error(`gateway ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const data = await res.json();
  const o = data.output;
  if (!o?.feature || !o?.steps || !Array.isArray(o.pages)) throw new Error('gateway returned an incomplete artifact set');
  return { artifacts: o, meta: { provider: data.provider, model: data.model } };
}

// --- support scaffolding (idempotent — written once if absent) --------------

function scaffoldSupport(baseURL) {
  const supportDir = join(CUCUMBER_ROOT, 'support');
  mkdirSync(supportDir, { recursive: true });

  const worldPath = join(supportDir, 'world.ts');
  if (!existsSync(worldPath)) {
    writeFileSync(worldPath, WORLD_TS(baseURL));
    console.log(`  scaffolded ${worldPath}`);
  }
  const hooksPath = join(supportDir, 'hooks.ts');
  if (!existsSync(hooksPath)) {
    writeFileSync(hooksPath, HOOKS_TS);
    console.log(`  scaffolded ${hooksPath}`);
  }
  const cucumberCfg = join(CUCUMBER_ROOT, 'cucumber.js');
  if (!existsSync(cucumberCfg)) {
    writeFileSync(cucumberCfg, CUCUMBER_JS);
    console.log(`  scaffolded ${cucumberCfg}`);
  }
}

// World: holds the browser/page/baseURL. baseURL is overridable via QA_BASE_URL
// so the same suite can target any of the profile's targets; the generator bakes
// the discovered target as the default.
const WORLD_TS = (baseURL) => `import { setWorldConstructor, World as CucumberWorld, IWorldOptions } from '@cucumber/cucumber';
import { Browser, BrowserContext, Page } from '@playwright/test';

// Default base URL discovered for this profile's target. Override at runtime with
// QA_BASE_URL to point the same suite at a different target (e.g. react vs angular).
const DEFAULT_BASE_URL = ${JSON.stringify(baseURL)};

export class World extends CucumberWorld {
  browser!: Browser;
  context!: BrowserContext;
  page!: Page;
  readonly baseURL: string;

  constructor(options: IWorldOptions) {
    super(options);
    this.baseURL = process.env.QA_BASE_URL || DEFAULT_BASE_URL;
  }
}

setWorldConstructor(World);
export default World;
`;

// Hooks: per-scenario browser lifecycle. Live external targets are slow → headroom.
const HOOKS_TS = `import { Before, After, setDefaultTimeout, ITestCaseHookParameter } from '@cucumber/cucumber';
import { chromium } from '@playwright/test';
import { World } from './world.js';

// Live external apps can be slow to load — generous per-step timeout.
setDefaultTimeout(60_000);

Before(async function (this: World) {
  this.browser = await chromium.launch({ headless: true });
  this.context = await this.browser.newContext();
  this.context.setDefaultNavigationTimeout(60_000);
  this.page = await this.context.newPage();
});

After(async function (this: World, _scenario: ITestCaseHookParameter) {
  await this.page?.close();
  await this.context?.close();
  await this.browser?.close();
});
`;

// Runner config — FLAT layout. NODE_OPTIONS='--import tsx' (set by the npm script)
// is what makes Cucumber load the TypeScript step/support/page files under ESM.
const CUCUMBER_JS = `// Cucumber-JS runner config — standard FLAT layout.
// Run with:  NODE_OPTIONS='--import tsx' cucumber-js   (see package.json test:cucumber)
// The --import tsx loader (env var, NOT --loader) is required for ESM + TypeScript.
export default {
  import: ['support/**/*.ts', 'steps/**/*.ts'],
  paths: ['features/**/*.feature'],
  format: ['progress-bar'],
};
`;

// --- main -------------------------------------------------------------------

async function main() {
  let trace;
  try {
    trace = JSON.parse(readFileSync(TRACE_PATH, 'utf8'));
  } catch {
    throw new Error(`no trace at ${TRACE_PATH} — run journey_discoverer (or intent_to_journey) first (QA_PROFILE=${profile.name}).`);
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

  // FLAT Cucumber layout — features/, steps/, pages/, support/ all under one root.
  const featuresDir = join(CUCUMBER_ROOT, 'features');
  const stepsDir = join(CUCUMBER_ROOT, 'steps');
  const pagesDir = join(CUCUMBER_ROOT, 'pages');
  mkdirSync(featuresDir, { recursive: true });
  mkdirSync(stepsDir, { recursive: true });
  mkdirSync(pagesDir, { recursive: true });

  // Scaffold shared support/config once (idempotent — never clobbers edits).
  scaffoldSupport(facts.baseURL);

  const eol = (s) => (s.endsWith('\n') ? s : s + '\n');
  const featurePath = join(featuresDir, `${facts.id}.feature`);
  const stepsPath = join(stepsDir, `${facts.id}.steps.ts`);
  writeFileSync(featurePath, eol(result.artifacts.feature));
  writeFileSync(stepsPath, eol(result.artifacts.steps));

  const written = [featurePath, stepsPath];
  for (const p of result.artifacts.pages) {
    // §10: the model sometimes returns a "pages/" prefix on the filename. We
    // already write into pages/, so strip it to avoid double-nesting.
    const fname = p.filename.replace(/^pages\//, '');
    const dest = join(pagesDir, fname);
    writeFileSync(dest, eol(p.contents));
    written.push(dest);
  }

  console.log(`generate: ${profile.name}/${facts.id} (Cucumber-JS) via ${result.meta.provider}:${result.meta.model}`);
  for (const w of written) console.log(`  wrote ${w}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
