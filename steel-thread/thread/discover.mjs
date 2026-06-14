#!/usr/bin/env node
/**
 * discover.mjs — steel-thread journey discovery.
 *
 * Drives the `agent-browser` CLI (Vercel Labs, v0.27) against the React build of
 * FundFlow to walk the `analyst-transfer-happy-path` defined in
 * shared/a11y-contract.md. For each step it captures an interactive
 * accessibility-tree snapshot (`snapshot -i --json`) and, by wrapping the whole
 * run in a HAR recording (`network har start` / `har stop`), the api_calls the
 * journey produced. The result is written to generated/trace.analyst-transfer.json.
 *
 * Boundaries (plan §19.5 / §20.5):
 *   - agent-browser is fenced to localhost via --allowed-domains.
 *   - A dedicated --session keeps us off the machine-shared `default` session.
 *   - `agent-browser close --all` runs in a finally block.
 *
 * Graceful degradation: if agent-browser or the React app is not reachable, we
 * print a clear message and STILL write a hand-authored reference trace (the
 * journey transcribed from the contract) so the rest of the pipeline — the trace
 * compiler and the Playwright runner — is exercisable without a live browser.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATED = join(__dirname, 'generated');
const TRACE_PATH = join(GENERATED, 'trace.analyst-transfer.json');
const HAR_PATH = join(GENERATED, 'discover.har');

const REACT_BASE = process.env.STEEL_THREAD_REACT_URL || 'http://localhost:5173';
const SESSION = 'steel-thread';
const ALLOWED_DOMAINS = 'localhost';

// ---------------------------------------------------------------------------
// agent-browser invocation helpers
// ---------------------------------------------------------------------------

/** Run `agent-browser <args...>` in a login shell so PATH/nvm resolve it. */
function ab(args, { json = false } = {}) {
  const full = ['agent-browser', ...args, '--session', SESSION];
  if (json) full.push('--json');
  // Use a login shell because agent-browser is on PATH only after profile init.
  const cmd = full.map(shellQuote).join(' ');
  const res = spawnSync('bash', ['-lc', cmd], { encoding: 'utf8' });
  return {
    ok: res.status === 0,
    status: res.status,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
    error: res.error,
  };
}

function shellQuote(s) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** snapshot -i --json, parsed. Returns the parsed tree or the raw string. */
function snapshot() {
  const res = ab(['snapshot', '-i'], { json: true });
  if (!res.ok) return { error: res.stderr || res.error?.message || 'snapshot failed' };
  try {
    return JSON.parse(res.stdout);
  } catch {
    return { raw: res.stdout };
  }
}

/** Pull api_calls out of a HAR file produced by `network har stop`. */
function readApiCalls(harText) {
  try {
    const har = JSON.parse(harText);
    const entries = har?.log?.entries ?? [];
    return entries
      .filter((e) => /\/api\//.test(e?.request?.url ?? ''))
      .map((e) => ({
        method: e.request.method,
        url: e.request.url,
        status: e.response?.status ?? null,
      }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// The journey, transcribed from shared/a11y-contract.md "reference journey".
// Each step declares the intent, route, and the action expressed purely as
// role + accessible-name target + value — exactly what the compiler consumes.
// ---------------------------------------------------------------------------

const JOURNEY = {
  id: 'analyst-transfer-happy-path',
  role: 'analyst',
  title: 'Analyst initiates and confirms a transfer (happy path)',
  contract: 'shared/a11y-contract.md',
  steps: [
    {
      intent: 'Sign in as the analyst',
      route: '/login',
      actions: [
        { kind: 'fill', target: { role: 'textbox', name: 'Username' }, value: 'analyst' },
        { kind: 'fill', target: { role: 'textbox', name: 'Password' }, value: 'demo1234' },
        { kind: 'click', target: { role: 'button', name: 'Sign in' } },
      ],
    },
    {
      intent: 'Land on the dashboard and start a transfer',
      route: '/dashboard',
      assertions: [{ role: 'heading', level: 1, name: 'Dashboard' }],
      actions: [{ kind: 'click', target: { role: 'button', name: 'Initiate Transfer' } }],
    },
    {
      intent: 'Fill in the transfer details and continue to review',
      route: '/transfer',
      actions: [
        { kind: 'select', target: { role: 'combobox', name: 'From account' }, value: 'Operating' },
        { kind: 'select', target: { role: 'combobox', name: 'Payee' }, value: 'Acme Supplies' },
        { kind: 'fill', target: { role: 'textbox', name: 'Amount' }, value: '2500' },
        { kind: 'fill', target: { role: 'textbox', name: 'Memo' }, value: 'Q2 invoice' },
        { kind: 'click', target: { role: 'button', name: 'Continue to review' } },
      ],
    },
    {
      intent: 'Review the transfer and confirm it (the money gate)',
      route: '/transfer/review',
      assertions: [{ role: 'text', name: 'Amount: $2,500.00' }],
      // This is the gating action. Discovery captures pre/post snapshots so the
      // compiler can assert the CAUSED state change (see assertion-bar.md).
      gating: true,
      actions: [{ kind: 'click', target: { role: 'button', name: 'Confirm transfer' } }],
    },
    {
      intent: 'Arrive on the receipt; the transfer is complete',
      route: '/transfer/receipt/:id',
      // The caused-state-change assertion bar:
      assertions: [
        { role: 'heading', level: 1, name: 'Transfer Complete' },
        { role: 'text', namePattern: 'Transaction ID:\\s*\\S+' },
      ],
      actions: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// Hand-authored reference trace (fallback). Mirrors what a live run produces:
// per step the intent, route, action(s) as role+name+value, and observed
// api_calls. The gating step carries a caused_state_change block.
// ---------------------------------------------------------------------------

function referenceTrace(reason) {
  const apiByRoute = {
    '/login': [{ method: 'POST', url: 'http://localhost:4000/api/login', status: 200 }],
    '/dashboard': [
      { method: 'GET', url: 'http://localhost:4000/api/accounts', status: 200 },
    ],
    '/transfer': [
      { method: 'GET', url: 'http://localhost:4000/api/accounts', status: 200 },
      { method: 'GET', url: 'http://localhost:4000/api/payees', status: 200 },
    ],
    '/transfer/review': [
      { method: 'POST', url: 'http://localhost:4000/api/transfers', status: 201 },
    ],
    '/transfer/receipt/:id': [],
  };

  return {
    journeyId: JOURNEY.id,
    role: JOURNEY.role,
    title: JOURNEY.title,
    source: 'reference',
    reason,
    contract: JOURNEY.contract,
    capturedAt: new Date().toISOString(),
    reactBaseUrl: REACT_BASE,
    steps: JOURNEY.steps.map((step) => ({
      intent: step.intent,
      route: step.route,
      assertions: step.assertions ?? [],
      actions: step.actions,
      apiCalls: apiByRoute[step.route] ?? [],
      ...(step.gating
        ? {
            causedStateChange: {
              note:
                'Post-action snapshot adds the receipt heading + a populated Transaction ID; ' +
                'these were absent before the Confirm transfer click. This is the assertion bar.',
              addedNodes: [
                { role: 'heading', level: 1, name: 'Transfer Complete' },
                { role: 'text', namePattern: 'Transaction ID:\\s*\\S+' },
              ],
            },
          }
        : {}),
    })),
  };
}

// ---------------------------------------------------------------------------
// Live discovery
// ---------------------------------------------------------------------------

/**
 * Resolve a snapshot ref (e.g. "e3") for a target by role + accessible name.
 * Used for <select> comboboxes, which agent-browser drives by @ref, not by label.
 */
function refFor(role, name) {
  const snap = snapshot();
  const refs = snap?.data?.refs ?? {};
  for (const [ref, node] of Object.entries(refs)) {
    if (node.role === role && node.name === name) return ref;
  }
  return null;
}

/**
 * Perform one contract action via the agent-browser forms that actually work in
 * v0.27 (verified live against the React build):
 *   - text inputs  → `find label <name> fill <value>`
 *   - buttons      → `find role button click --name <name>`
 *   - comboboxes   → snapshot to a @ref, then `select @ref <value>`
 * Everything resolves by accessible name — the contract surface, framework-blind.
 */
function performAction(action) {
  const { kind, target, value } = action;
  const name = target.name;
  switch (kind) {
    case 'fill':
      return ab(['find', 'label', name, 'fill', value]);
    case 'click': {
      const byRole = ab(['find', 'role', target.role, 'click', '--name', name]);
      // Contract CTAs may be a link rather than a button; fall back to text.
      return byRole.ok ? byRole : ab(['find', 'text', name, 'click']);
    }
    case 'select': {
      const ref = refFor(target.role || 'combobox', name);
      if (!ref) return { ok: false, stderr: `no ref for ${target.role}/${name}` };
      return ab(['select', `@${ref}`, value]);
    }
    default:
      return { ok: false, stderr: `unknown action kind: ${kind}` };
  }
}

function liveDiscover() {
  // Open the app. A non-zero exit here means the browser/app is unreachable.
  const opened = ab(['open', `${REACT_BASE}/login`, '--allowed-domains', ALLOWED_DOMAINS]);
  if (!opened.ok) {
    throw new Error(
      `agent-browser could not open ${REACT_BASE}/login ` +
        `(${opened.stderr || opened.error?.message || 'unreachable'})`,
    );
  }

  // Begin HAR capture for api_calls across the whole journey.
  ab(['network', 'har', 'start', HAR_PATH]);
  ab(['wait', '1000']); // let the SPA mount the first screen

  const steps = [];
  for (const step of JOURNEY.steps) {
    ab(['wait', '700']); // let the previous navigation settle before perceiving
    // Snapshot BEFORE acting (pre-action state for the gating diff).
    const pre = snapshot();

    let causedStateChange;
    for (const action of step.actions) {
      const res = performAction(action);
      if (!res.ok) {
        throw new Error(
          `step "${step.intent}" action ${action.kind} on ` +
            `${action.target.role}/${action.target.name} failed: ${res.stderr}`,
        );
      }
    }

    // Snapshot AFTER acting (post-action state).
    const post = step.actions.length ? snapshot() : pre;

    if (step.gating) {
      causedStateChange = {
        note:
          'Diff of post-action vs pre-action snapshot for the gating step. ' +
          'The compiler must assert at least one added node (assertion-bar.md).',
        preSnapshot: pre,
        postSnapshot: post,
        expectedAddedNodes: [
          { role: 'heading', level: 1, name: 'Transfer Complete' },
          { role: 'text', namePattern: 'Transaction ID:\\s*\\S+' },
        ],
      };
    }

    steps.push({
      intent: step.intent,
      route: step.route,
      assertions: step.assertions ?? [],
      actions: step.actions,
      snapshot: post,
      ...(causedStateChange ? { causedStateChange } : {}),
    });
  }

  // Stop HAR, read api_calls, and attribute them to the closest step by URL.
  const harStop = ab(['network', 'har', 'stop', HAR_PATH]);
  let apiCalls = [];
  if (harStop.ok) {
    try {
      const harText = readFileSafe(HAR_PATH);
      apiCalls = readApiCalls(harText);
    } catch {
      /* best-effort */
    }
  }

  // Attach the flat api_calls list and a per-step bucket keyed by endpoint.
  attachApiCalls(steps, apiCalls);

  return {
    journeyId: JOURNEY.id,
    role: JOURNEY.role,
    title: JOURNEY.title,
    source: 'agent-browser',
    contract: JOURNEY.contract,
    capturedAt: new Date().toISOString(),
    reactBaseUrl: REACT_BASE,
    apiCalls,
    steps,
  };
}

function attachApiCalls(steps, apiCalls) {
  const buckets = {
    '/login': /\/api\/login/,
    '/dashboard': /\/api\/accounts/,
    '/transfer': /\/api\/(accounts|payees)/,
    '/transfer/review': /\/api\/transfers\b/,
  };
  for (const step of steps) {
    const re = buckets[step.route];
    step.apiCalls = re ? apiCalls.filter((c) => re.test(c.url)) : [];
  }
}

function readFileSafe(p) {
  return readFileSync(p, 'utf8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  mkdirSync(GENERATED, { recursive: true });

  let trace;
  let usedFallback = false;
  try {
    trace = liveDiscover();
    console.log('discover: live agent-browser run succeeded.');
  } catch (err) {
    usedFallback = true;
    const reason = err?.message || String(err);
    console.error('\n[discover] live discovery failed — falling back to reference trace.');
    console.error(`[discover] reason: ${reason}`);
    console.error(
      '[discover] Ensure the mock API (:4000) and React app (:5173) are running and ' +
        'that `agent-browser` is installed (see run.md). Writing the hand-authored ' +
        'reference trace so compile + test stay exercisable.\n',
    );
    trace = referenceTrace(reason);
  } finally {
    // Always close our session, even on the fallback path.
    const closed = ab(['close', '--all']);
    if (!closed.ok) {
      console.error(`[discover] note: agent-browser close --all returned: ${closed.stderr}`);
    }
  }

  writeFileSync(TRACE_PATH, JSON.stringify(trace, null, 2) + '\n');
  console.log(`discover: wrote ${TRACE_PATH} (source: ${trace.source}).`);
  if (usedFallback) {
    console.log('discover: used the deterministic reference trace (no live browser).');
  }
}

main();
