#!/usr/bin/env node
/**
 * intent_to_journey.mjs — the SCAFFOLD lane (plan §5 / AGENTS.md three-lane architecture).
 *
 * RECONSTRUCTED FROM SPEC — verify against office code.
 *   This agent is DESCRIBED in detail (engine loop, output formats, design
 *   decisions) in the session audit "Intent-to-Journey Scaffold Lane" section,
 *   but its source is NOT fully quoted. The implementation below faithfully
 *   matches the documented contract; cross-check against the office code.
 *
 * PURPOSE: bridge a plain-English intent → AI-driven LIVE discovery → a
 * structured trace (test_generator input) + a profile-compatible journey def.
 * Same engine as intent_verifier, but RECORDS rather than just judges:
 *     open URL → snapshot → gateway decide → exec → record action → repeat
 *
 * Differences from intent_verifier (per audit):
 *  - Emits out/trace.<intentId>.json  (test_generator's input format — mirrors
 *    journey_discoverer's trace shape, incl. causedStateChange pre/post snapshots).
 *  - Emits out/journey.<intentId>.json (paste-able into profile.json journeys[]).
 *  - Tool schema is `scaffold_decision` with step_intent / is_gating / caused_state.
 *  - Groups actions by step_intent → one trace step per business-level step.
 *  - On PASS writes both outputs; on FAIL throws (no partial trace).
 *
 * Output (ephemeral, gitignored — under profiles/<name>/out/):
 *   out/trace.<intentId>.json
 *   out/journey.<intentId>.json
 *
 * Then: QA_PROFILE=<name> node test_generator.mjs <intentId>  → Cucumber BDD.
 *
 * Usage: QA_PROFILE=cms-ui node intent_to_journey.mjs <intentId>
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadProfile } from '../profile.mjs';

const profile = loadProfile();
const intentId = process.argv[2];
if (!intentId) throw new Error('usage: QA_PROFILE=<name> node intent_to_journey.mjs <intentId>');

const intents = profile.raw?.intents || [];
const intent = intents.find((it) => it.id === intentId);
if (!intent) throw new Error(`no intent "${intentId}" in profile ${profile.name}`);

const target = profile.targets[0];
if (!target) throw new Error(`profile ${profile.name} has no targets`);
const HOST = new URL(target.baseURL).hostname;
const SESSION = `i2j-${profile.name}`;

const OUT_DIR = profile.workDir;
const TRACE_PATH = join(OUT_DIR, `trace.${intent.id}.json`);
const JOURNEY_PATH = join(OUT_DIR, `journey.${intent.id}.json`);

// --- agent-browser (cross-platform: shell:true, no POSIX shellQuote) --------

function ab(args, { json = false } = {}) {
  const full = [...args, '--session', SESSION];
  if (json) full.push('--json');
  const res = spawnSync('agent-browser', full, { encoding: 'utf8', shell: true });
  return { ok: res.status === 0, status: res.status, stdout: (res.stdout || '').trim(), stderr: (res.stderr || '').trim(), error: res.error };
}
function snapshot() {
  const res = ab(['snapshot', '-i'], { json: true });
  if (!res.ok) return { error: res.stderr || 'snapshot failed' };
  try { return JSON.parse(res.stdout); } catch { return { raw: res.stdout }; }
}

function resolveEnv(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => process.env[k] ?? `\${${k}}`);
}
// Keep ${VAR} placeholder form in recorded values (the trace must NOT leak creds).
function placeholderForm(s) {
  return typeof s === 'string' ? s.replace(/\$\{([A-Z0-9_]+)\}/g, '${$1}') : s;
}

// --- caused_state parsing (heuristic, per audit "Why caused_state as a string") ---
//
// The model describes what appeared in free text, e.g. `link "Bulk"`,
// `heading 'Dashboard'`. Parse it into { role, name } for expectedAddedNodes.
const KNOWN_ROLES = ['link', 'button', 'heading', 'textbox', 'checkbox', 'radio', 'tab', 'menuitem', 'option', 'cell', 'row', 'navigation', 'list', 'listitem', 'img', 'banner', 'region', 'dialog', 'alert', 'searchbox', 'combobox'];
function parseCausedState(s) {
  if (!s || typeof s !== 'string') return null;
  // role then a quoted name: link "Bulk"  /  heading 'Dashboard'
  const m = s.match(/\b(\w+)\b\s*["'“”‘’]([^"'“”‘’]+)["'“”‘’]/);
  if (m && KNOWN_ROLES.includes(m[1].toLowerCase())) {
    return { role: m[1].toLowerCase(), name: m[2].trim() };
  }
  // just a quoted name, no role → default to link (common nav case)
  const q = s.match(/["'“”‘’]([^"'“”‘’]+)["'“”‘’]/);
  if (q) return { role: 'link', name: q[1].trim() };
  return null;
}

// --- gateway: scaffold_decision --------------------------------------------

const SCAFFOLD_TOOL = {
  name: 'scaffold_decision',
  description: 'Decide the next action while discovering the path that satisfies a plain-English intent, recording a trace.',
  input_schema: {
    type: 'object',
    properties: {
      // string enums for Azure strict json_schema (no optional booleans).
      status: { type: 'string', enum: ['act', 'done', 'fail'], description: 'act = perform a command; done = the intent is satisfied; fail = cannot satisfy it.' },
      command: { type: 'string', enum: ['fill', 'click', 'select', 'none'], description: 'The action kind when status=act.' },
      role: { type: 'string', description: 'ARIA role of the target (textbox, button, link, heading, ...).' },
      name: { type: 'string', description: 'Exact accessible name of the target element.' },
      value: { type: 'string', description: 'Fill/select value (keep ${VAR} placeholders verbatim).' },
      step_intent: { type: 'string', description: 'Business-level description of the step this action belongs to (e.g. "Sign in as the test user"). Actions sharing a step_intent are grouped into one trace step → one Gherkin When.' },
      is_gating: { type: 'string', enum: ['true', 'false'], description: 'Whether this step asserts a caused state change (string enum for strict json_schema).' },
      caused_state: { type: 'string', description: 'When is_gating=true: a short description of the node that appears as a result, e.g. link "Bulk" or heading "Dashboard". Empty otherwise.' },
      reason: { type: 'string', description: 'Short justification.' },
    },
    required: ['status', 'command', 'role', 'name', 'value', 'step_intent', 'is_gating', 'caused_state', 'reason'],
  },
};

async function decide(snap, history) {
  const refs = snap?.data?.refs ?? {};
  const named = Object.values(refs).filter((n) => n.name).slice(0, 40).map((n) => ({ role: n.role, name: n.name }));
  const text = `You are the platform's SCAFFOLD-lane agent. Drive a LIVE app via agent-browser to satisfy this intent, ONE action at a time, recording a trace for deterministic BDD generation.
Intent: "${intent.description}". Given: "${intent.given ?? ''}".
Ordered hints (plain English) for HOW to satisfy it:
${JSON.stringify((intent.verify || []).map(placeholderForm))}

Actions already performed this run:
${JSON.stringify(history)}

The live page currently exposes these named accessibility nodes (role + accessible name):
${JSON.stringify(named)}

Decide the NEXT action. Call scaffold_decision exactly once.
- status="act" + command + EXACT role/name from the list above (deterministic role + accessible name
  only — never CSS). For fill, supply value (keep ${'${VAR}'} placeholders verbatim; never invent creds).
- Set step_intent to the business-level step this action belongs to (group related clicks/fills under
  the SAME step_intent text — e.g. all login fields share "Sign in as the test user").
- Set is_gating="true" on the action that should CAUSE a verifiable state change, and put a short
  caused_state like  link "Bulk"  or  heading "Dashboard"  describing the node that then appears.
- status="done" when the intent's end-state node is already present; status="fail" if it cannot be reached.`;
  const res = await fetch(`${profile.gateway.url}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      repo: profile.name,
      tier: 'reasoning',
      max_tokens: 700,
      messages: [{ role: 'user', content: text }],
      tool: SCAFFOLD_TOOL,
      tool_choice: { type: 'tool', name: 'scaffold_decision' },
      payload_types: ['a11y-tree'],
    }),
  });
  if (!res.ok) throw new Error(`gateway ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const data = await res.json();
  if (!data.output?.status) throw new Error('gateway returned no decision');
  return data.output;
}

// Resolve the model's {role, name} to a live @ref and act. Records the action
// with a Tier-1 role+name locator (the scaffold lane targets named nodes; the
// generator's full ladder still applies when the discoverer is used instead).
function execAct(d) {
  const snap = snapshot();
  const refs = snap?.data?.refs ?? {};
  const hit = Object.entries(refs).find(([, n]) => n.role === d.role && (n.name ?? '').trim() === (d.name ?? '').trim());
  if (!hit) return { ok: false, ref: null };
  const ref = hit[0];
  if (d.command === 'fill') ab(['fill', `@${ref}`, resolveEnv(d.value)]);
  else if (d.command === 'select') ab(['select', `@${ref}`, resolveEnv(d.value)]);
  else if (d.command === 'click') ab(['click', `@${ref}`]);
  ab(['wait', '1200']);
  return { ok: true, ref };
}

// --- discover & record ------------------------------------------------------

async function scaffold() {
  const url = target.baseURL.replace(/\/$/, '') + (intent.entryPath || '/');
  const openArgs = ['open', url, '--allowed-domains', HOST];
  if (profile.auth?.mode === 'session' && existsSync(profile.auth.statePath)) {
    openArgs.push('--state', profile.auth.statePath);
  }
  const opened = ab(openArgs);
  if (!opened.ok) throw new Error(`could not open ${url} (${opened.stderr || opened.error?.message})`);
  ab(['wait', '1500']);

  // Each recorded action: kind, target{role,name}, value(placeholder), stepIntent,
  // isGating, causedState, pre/postSnapshot. Grouped by stepIntent afterwards.
  const recorded = [];
  const history = [];
  const maxSteps = 16;
  let done = false;

  for (let i = 0; i < maxSteps && !done; i++) {
    const pre = snapshot();
    let d;
    try { d = await decide(pre, history); }
    catch (e) { throw new Error(`scaffold decide failed: ${e.message}`); }

    if (d.status === 'fail') throw new Error(`intent "${intent.id}" could not be satisfied: ${d.reason}`);
    if (d.status === 'done') { done = true; break; }
    if (d.command === 'none') { done = true; break; }

    const result = execAct(d);
    if (!result.ok) {
      // Node not present yet — record the attempt in history and re-loop once;
      // if the model keeps missing, the step cap ends the run.
      history.push({ command: d.command, role: d.role, name: d.name, note: 'target not found in snapshot' });
      continue;
    }
    const post = snapshot();
    const isGating = d.is_gating === 'true';
    recorded.push({
      kind: d.command,
      target: { role: d.role, name: d.name },
      value: placeholderForm(d.value) || null,
      stepIntent: d.step_intent || intent.description,
      isGating,
      causedState: isGating ? parseCausedState(d.caused_state) : null,
      locator: { strategy: 'role+name', role: d.role, name: d.name, value: null, debt: false },
      preSnapshot: pre,
      postSnapshot: post,
    });
    history.push({ command: d.command, role: d.role, name: d.name, stepIntent: d.step_intent });
  }

  if (!recorded.length) throw new Error(`intent "${intent.id}": no actions recorded (nothing to scaffold)`);
  return recorded;
}

// Group recorded actions by stepIntent → trace steps (one Gherkin When per step).
function buildTrace(recorded) {
  const steps = [];
  let cur = null;
  for (const a of recorded) {
    if (!cur || cur.intent !== a.stepIntent) {
      cur = { intent: a.stepIntent, route: null, assertions: [], actions: [], _pre: a.preSnapshot, _post: a.postSnapshot, _gating: false, _added: [] };
      steps.push(cur);
    }
    cur.actions.push({ kind: a.kind, target: a.target, value: a.value, locator: a.locator });
    cur._post = a.postSnapshot; // last action's post is the step's resulting state
    if (a.isGating && a.causedState) { cur._gating = true; cur._added.push(a.causedState); }
  }

  const traceSteps = steps.map((s) => {
    const step = { intent: s.intent, route: null, assertions: [], actions: s.actions, snapshot: s._post };
    if (s._gating) {
      step.causedStateChange = {
        note: 'Diff of post-action vs pre-action snapshot for the gating step (assertion-bar).',
        preSnapshot: s._pre,
        postSnapshot: s._post,
        expectedAddedNodes: s._added,
      };
    }
    return step;
  });

  return {
    journeyId: intent.id,
    role: 'discovered',
    title: intent.description,
    source: 'intent_to_journey',
    profile: profile.name,
    targetBaseUrl: target.baseURL,
    entryPath: intent.entryPath ?? '/',
    contract: null,
    capturedAt: new Date().toISOString(),
    steps: traceSteps,
  };
}

// Profile-compatible journey (paste-able into profile.json journeys[]).
function buildJourney(trace) {
  return {
    id: intent.id,
    role: 'discovered',
    title: intent.description,
    entryPath: intent.entryPath ?? '/',
    steps: trace.steps.map((s) => ({
      intent: s.intent,
      gating: Boolean(s.causedStateChange),
      actions: s.actions.map((a) => ({ kind: a.kind, target: a.target, ...(a.value != null ? { value: a.value } : {}) })),
      ...(s.causedStateChange ? { causedStateChange: s.causedStateChange.expectedAddedNodes } : {}),
    })),
  };
}

// --- main -------------------------------------------------------------------

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  let recorded;
  try {
    recorded = await scaffold();
    console.log(`scaffold: live discovery succeeded for ${profile.name}/${intent.id}.`);
  } finally {
    ab(['close', '--all']);
  }

  const trace = buildTrace(recorded);
  const journey = buildJourney(trace);

  // On PASS only — write both (audit: "on FAIL throws; no partial trace").
  writeFileSync(TRACE_PATH, JSON.stringify(trace, null, 2) + '\n');
  writeFileSync(JOURNEY_PATH, JSON.stringify(journey, null, 2) + '\n');
  console.log(`scaffold: wrote ${TRACE_PATH}`);
  console.log(`scaffold: wrote ${JOURNEY_PATH}`);
  const gate = trace.steps.find((s) => s.causedStateChange);
  if (gate) {
    for (const n of gate.causedStateChange.expectedAddedNodes) {
      console.log(`  caused-state-change ${n.role} "${n.name}" recorded as the assertion bar.`);
    }
  }
  console.log(`scaffold: next → QA_PROFILE=${profile.name} node toolkit/agents/test_generator.mjs ${intent.id}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
