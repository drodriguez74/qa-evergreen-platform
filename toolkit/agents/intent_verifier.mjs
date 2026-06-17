#!/usr/bin/env node
/**
 * intent_verifier.mjs — the PROOF lane (plan §5 / AGENTS.md three-lane architecture).
 *
 * RECONSTRUCTED FROM SPEC — verify against office code.
 *   This agent is DESCRIBED (not fully quoted) in the session audit + AGENTS.md.
 *   The behaviour below is a faithful implementation of the documented contract:
 *   reads a profile's `intents[]`, drives the LIVE app via agent-browser under
 *   AI guidance from the gateway, judges each intent PASS/FAIL against the live
 *   surface, and writes a coverage manifest + evidence screenshots. No test code
 *   is generated (that is the scaffold lane's job — intent_to_journey.mjs).
 *
 * Generic + PROFILE-DRIVEN. No app specifics here — everything comes from the
 * profile's intents[] (plain-English `given` + ordered `verify[]` steps, with
 * ${CRED} placeholders resolved from env).
 *
 * Output (ephemeral, gitignored — under profiles/<name>/out/):
 *   out/coverage-manifest.json     — per-intent PASS/FAIL gate result
 *   out/evidence/<intentId>-start.png, <intentId>-pass.png  — screenshots
 *
 * Golden rules honored: ALL model calls go through the gateway; no vendor SDK;
 * secrets only via env (resolved into ${...} placeholders), never logged.
 *
 * Usage: QA_PROFILE=cms-ui node intent_verifier.mjs [intentId]   # one or all intents
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadProfile } from '../profile.mjs';

const profile = loadProfile();
const onlyId = process.argv[2];

const intents = profile.raw?.intents || [];
if (!intents.length) throw new Error(`profile ${profile.name} has no intents[] (proof lane needs them)`);
const selected = onlyId ? intents.filter((it) => it.id === onlyId) : intents;
if (!selected.length) throw new Error(`no intent "${onlyId}" in profile ${profile.name}`);

const target = profile.targets[0];
if (!target) throw new Error(`profile ${profile.name} has no targets`);
const HOST = new URL(target.baseURL).hostname;
const SESSION = `intent-${profile.name}`;

const OUT_DIR = profile.workDir; // profiles/<name>/out for directory profiles
const EVID_DIR = join(OUT_DIR, 'evidence');
const MANIFEST_PATH = join(OUT_DIR, 'coverage-manifest.json');

// --- agent-browser (cross-platform: shell:true, no POSIX shellQuote) --------

function ab(args, { json = false } = {}) {
  const full = [...args, '--session', SESSION];
  if (json) full.push('--json');
  // { shell: true } → cmd.exe on win32, /bin/sh on Unix. Works without WSL.
  const res = spawnSync('agent-browser', full, { encoding: 'utf8', shell: true });
  return { ok: res.status === 0, status: res.status, stdout: (res.stdout || '').trim(), stderr: (res.stderr || '').trim(), error: res.error };
}
function snapshot() {
  const res = ab(['snapshot', '-i'], { json: true });
  if (!res.ok) return { error: res.stderr || 'snapshot failed' };
  try { return JSON.parse(res.stdout); } catch { return { raw: res.stdout }; }
}

// Resolve ${VAR} placeholders from the environment. Never logs the value.
function resolveEnv(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => process.env[k] ?? `\${${k}}`);
}
// A redacted copy for logs/manifest — keeps ${VAR} placeholder text, hides values.
function redact(s) {
  return typeof s === 'string' ? s.replace(/\$\{([A-Z0-9_]+)\}/g, '${$1}') : s;
}

// --- gateway: ask the model to ACT or JUDGE ---------------------------------
//
// The verifier is AI-driven: rather than prescriptive role+name steps, it hands
// the live a11y snapshot + the plain-English verify[] line to the model and lets
// the model decide the single next agent-browser command (or declare the intent
// satisfied/failed). This is what lets the proof lane verify intents whose exact
// steps are not specified up front.

const DECIDE_TOOL = {
  name: 'verify_decision',
  description: 'Decide the next action while verifying a plain-English intent against the live app.',
  input_schema: {
    type: 'object',
    properties: {
      // string enum (not boolean) — Azure strict json_schema needs all-required,
      // no optional booleans (see audit "Design Decisions").
      status: { type: 'string', enum: ['act', 'pass', 'fail'], description: 'act = perform a command; pass/fail = the intent is verified/refuted now.' },
      command: { type: 'string', enum: ['fill', 'click', 'select', 'assert', 'none'], description: 'The agent-browser-style command to perform when status=act.' },
      role: { type: 'string', description: 'ARIA role of the target element (e.g. textbox, button, link, heading).' },
      name: { type: 'string', description: 'Exact accessible name of the target element.' },
      value: { type: 'string', description: 'Value to fill/select (may contain ${VAR} placeholders).' },
      reason: { type: 'string', description: 'Short justification for this decision.' },
    },
    required: ['status', 'command', 'role', 'name', 'value', 'reason'],
  },
};

async function decide(intent, verifyLine, snap) {
  const refs = snap?.data?.refs ?? {};
  const named = Object.values(refs).filter((n) => n.name).slice(0, 40).map((n) => ({ role: n.role, name: n.name }));
  const text = `You are the platform's PROOF-lane intent verifier, driving a LIVE app via agent-browser.
Intent: "${intent.description}". Given: "${intent.given ?? ''}".
You are working through this single verify step (plain English): "${redact(verifyLine)}".
The live page currently exposes these named accessibility nodes (role + accessible name):
${JSON.stringify(named)}

Decide the NEXT action. Call verify_decision exactly once.
- If the step is an ACTION (fill/click/select), set status="act", command to the kind, and role+name
  to the EXACT target node from the list above (deterministic role + accessible name only — never CSS).
  For a fill, put the value (keep any ${'${VAR}'} placeholder verbatim — do NOT invent credentials).
- If the step is an ASSERTION ("X is visible", "proves ...") and the asserted node IS present above,
  set status="pass". If it is clearly absent and cannot appear, set status="fail".
- Use command="none", role="", name="", value="" for pass/fail.`;
  const res = await fetch(`${profile.gateway.url}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      repo: profile.name,
      tier: 'reasoning',
      max_tokens: 600,
      messages: [{ role: 'user', content: text }],
      tool: DECIDE_TOOL,
      tool_choice: { type: 'tool', name: 'verify_decision' },
      payload_types: ['a11y-tree'],
    }),
  });
  if (!res.ok) throw new Error(`gateway ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const data = await res.json();
  if (!data.output?.status) throw new Error('gateway returned no decision');
  return data.output;
}

// Perform one model decision against the live page. Returns 'continue'|'pass'|'fail'.
function execDecision(d) {
  if (d.status === 'pass') return 'pass';
  if (d.status === 'fail') return 'fail';
  // status === 'act' — assert decisions are verified against the snapshot.
  if (d.command === 'assert' || d.command === 'none') {
    const snap = snapshot();
    const refs = snap?.data?.refs ?? {};
    const present = Object.values(refs).some((n) => n.role === d.role && (n.name ?? '').trim() === (d.name ?? '').trim());
    return present ? 'pass' : 'continue';
  }
  const snap = snapshot();
  const refs = snap?.data?.refs ?? {};
  const hit = Object.entries(refs).find(([, n]) => n.role === d.role && (n.name ?? '').trim() === (d.name ?? '').trim());
  if (!hit) return 'continue'; // node not (yet) present — let the loop re-snapshot
  const ref = hit[0];
  if (d.command === 'fill') ab(['fill', `@${ref}`, resolveEnv(d.value)]);
  else if (d.command === 'select') ab(['select', `@${ref}`, resolveEnv(d.value)]);
  else if (d.command === 'click') ab(['click', `@${ref}`]);
  ab(['wait', '1200']);
  return 'continue';
}

// --- verify one intent ------------------------------------------------------

async function verifyIntent(intent) {
  const url = target.baseURL.replace(/\/$/, '') + (intent.entryPath || '/');
  const openArgs = ['open', url, '--allowed-domains', HOST];
  if (profile.auth?.mode === 'session' && existsSync(profile.auth.statePath)) {
    openArgs.push('--state', profile.auth.statePath);
  }
  const opened = ab(openArgs);
  if (!opened.ok) throw new Error(`could not open ${url} (${opened.stderr || opened.error?.message})`);
  ab(['wait', '1500']);

  const startShot = join(EVID_DIR, `${intent.id}-start.png`);
  ab(['screenshot', startShot]);

  const maxMs = (intent.maxDurationSeconds ?? 60) * 1000;
  const deadline = Date.now() + maxMs;
  const evidence = [{ kind: 'start', path: startShot }];
  let verdict = 'fail';
  let detail = 'no verify[] steps completed';

  const verifySteps = intent.verify || [];
  outer: for (const line of verifySteps) {
    let guard = 0;
    while (Date.now() < deadline && guard++ < 6) {
      const snap = snapshot();
      let d;
      try { d = await decide(intent, line, snap); }
      catch (e) { detail = `gateway decide failed: ${e.message} [cause: ${e.cause?.code || e.cause?.message || e.cause || '?'}] [snap: ${snap?.error ? 'ERR ' + snap.error : 'ok'}]`; break outer; }
      const outcome = execDecision(d);
      if (outcome === 'pass') { verdict = 'pass'; detail = redact(line); continue outer; }
      if (outcome === 'fail') { verdict = 'fail'; detail = `refuted: ${redact(line)} (${d.reason})`; break outer; }
      // 'continue' — action performed (or node not yet present); loop/snapshot again.
      if (d.status === 'act' && (d.command === 'fill' || d.command === 'click' || d.command === 'select')) continue outer;
    }
  }

  if (verdict === 'pass') {
    const passShot = join(EVID_DIR, `${intent.id}-pass.png`);
    ab(['screenshot', passShot]);
    evidence.push({ kind: 'pass', path: passShot });
  }

  return {
    id: intent.id,
    description: intent.description,
    priority: intent.priority ?? 'medium',
    status: verdict,
    detail,
    entryPath: intent.entryPath ?? '/',
    verifySteps: verifySteps.map(redact),
    evidence,
    verifiedAt: new Date().toISOString(),
  };
}

// --- main -------------------------------------------------------------------

async function main() {
  mkdirSync(EVID_DIR, { recursive: true });
  const results = [];
  try {
    for (const intent of selected) {
      console.log(`verify: ${profile.name}/${intent.id} (${intent.priority ?? 'medium'}) — ${intent.description}`);
      let r;
      try { r = await verifyIntent(intent); }
      catch (e) { r = { id: intent.id, description: intent.description, priority: intent.priority ?? 'medium', status: 'fail', detail: e.message, evidence: [], verifiedAt: new Date().toISOString() }; }
      console.log(`  → ${r.status.toUpperCase()}${r.detail ? ` (${r.detail})` : ''}`);
      results.push(r);
    }
  } finally {
    ab(['close', '--all']);
  }

  const passed = results.filter((r) => r.status === 'pass').length;
  const manifest = {
    profile: profile.name,
    target: target.baseURL,
    generatedAt: new Date().toISOString(),
    lane: 'proof',
    summary: { total: results.length, passed, failed: results.length - passed },
    intents: results,
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`verify: wrote ${MANIFEST_PATH}  (${passed}/${results.length} passed)`);
  console.log(`verify: evidence under ${EVID_DIR}`);
  if (passed < results.length) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
