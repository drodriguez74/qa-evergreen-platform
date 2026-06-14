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

function factsFromTrace(trace) {
  const steps = trace.steps.map((s, i) => {
    const pre = s.causedStateChange?.preSnapshot ?? s.snapshot;
    return {
      n: i + 1,
      intent: s.intent,
      actions: (s.actions ?? []).map((a) => ({ kind: a.kind, role: a.target.role, name: a.target.name, value: a.value })),
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

Discovered steps (locate ONLY by role + accessible name from visibleNodes — getByRole / getByLabel; never CSS/testid):
${JSON.stringify(facts.steps, null, 2)}

HARD RULES:
- THE ASSERTION BAR: the spec MUST assert at least one node from the gating step's causedStateChange is visible AFTER the action (it was absent before). That is the state change the action caused — not merely a URL change.
- This is a LIVE remote app: use web-first assertions (await expect(locator).toBeVisible({ timeout: 15000 })) and reasonable waits. Do not assert exact transient content.
- Valid, runnable TypeScript. One Page Object class per screen, role + accessible name only. Use relative page.goto paths (baseURL comes from config).`;
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
