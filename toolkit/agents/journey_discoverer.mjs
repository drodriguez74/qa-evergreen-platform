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
import { mkdirSync, writeFileSync } from 'node:fs';
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
const HOST = new URL(target.baseURL).host;
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
function refFor(role, name) {
  const refs = snapshot()?.data?.refs ?? {};
  for (const [ref, node] of Object.entries(refs)) {
    if (node.role === role && node.name === name) return ref;
  }
  return null;
}

// Resolve a role+name target to a live @ref, then act. Buttons/links also accept
// agent-browser's `find role <r> click --name <n>` form; fills/selects go by @ref.
function performAction(action) {
  const { kind, target: t, value } = action;
  switch (kind) {
    case 'fill': {
      const ref = refFor(t.role, t.name);
      if (!ref) return { ok: false, stderr: `no ref for ${t.role}/"${t.name}"` };
      return ab(['fill', `@${ref}`, value]);
    }
    case 'select': {
      const ref = refFor(t.role || 'combobox', t.name);
      if (!ref) return { ok: false, stderr: `no ref for ${t.role}/"${t.name}"` };
      return ab(['select', `@${ref}`, value]);
    }
    case 'click': {
      const byRole = ab(['find', 'role', t.role, 'click', '--name', t.name]);
      if (byRole.ok) return byRole;
      const ref = refFor(t.role, t.name);
      return ref ? ab(['click', `@${ref}`]) : byRole;
    }
    default:
      return { ok: false, stderr: `unknown action kind: ${kind}` };
  }
}

// --- discover ---------------------------------------------------------------

function discover() {
  const url = target.baseURL.replace(/\/$/, '') + (journey.entryPath || '/');
  const opened = ab(['open', url, '--allowed-domains', HOST]);
  if (!opened.ok) throw new Error(`could not open ${url} (${opened.stderr || opened.error?.message})`);

  ab(['wait', '1500']);
  const steps = [];
  for (const step of journey.steps) {
    ab(['wait', '700']);
    const pre = snapshot();
    for (const action of step.actions || []) {
      const res = performAction(action);
      if (!res.ok) throw new Error(`step "${step.intent}" ${action.kind} ${action.target.role}/"${action.target.name}" failed: ${res.stderr}`);
    }
    ab(['wait', '1500']);
    const post = (step.actions || []).length ? snapshot() : pre;

    const record = { intent: step.intent, route: step.route ?? null, assertions: step.assertions ?? [], actions: step.actions ?? [], snapshot: post };
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

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  let trace;
  try {
    trace = discover();
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

main();
