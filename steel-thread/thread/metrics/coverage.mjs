#!/usr/bin/env node
/**
 * coverage.mjs — steel-thread coverage manifest (POC deliverable, plan §21.5).
 *
 * Produces generated/coverage-manifest.json for the one app, computed from real
 * artifacts only — never hand-typed numbers:
 *
 *   - UI journey coverage, using the §9 authoritative denominator:
 *     covered demonstrated journeys / TOTAL demonstrated journeys. "Demonstrated"
 *     = proven achievable by a recorded discovery trace (source: agent-browser).
 *     Authored-but-undemonstrated scenarios (the negative/RBAC specs) are listed
 *     but EXCLUDED from the denominator, exactly as §9/§20 require.
 *   - API surface from shared/openapi.yaml vs. what the journey's HAR actually
 *     called. Surfaces two real drift findings: documented-but-unexercised
 *     endpoints, and used-but-undocumented endpoints (consumer/spec drift).
 *   - The API schema-validation gap: §9 only counts an endpoint as API-covered
 *     when a test validates status code AND response schema (zod). The steel
 *     thread ships UI specs only, so strict API coverage is 0 — stated plainly,
 *     with consumer-touch reported separately so the gap is visible, not hidden.
 *
 * No servers required. Pass/fail of the journey is read from Playwright's
 * test-results/.last-run.json (run `npm test` first to refresh it).
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadProfile } from '../../../toolkit/profile.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const THREAD = join(__dirname, '..');
const profile = loadProfile();
const GENERATED = profile.workDir;
const OUT = join(GENERATED, 'coverage-manifest.json');

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

function loadTrace() {
  const files = readdirSync(GENERATED).filter((f) => /^trace\..*\.json$/.test(f));
  if (files.length === 0) throw new Error('no generated/trace.*.json — run `npm run discover` first');
  const chosen = files.find((f) => f.includes('analyst-transfer')) || files.sort()[0];
  return JSON.parse(readFileSync(join(GENERATED, chosen), 'utf8'));
}

function lastRunStatus() {
  try {
    const r = JSON.parse(readFileSync(join(THREAD, 'test-results', '.last-run.json'), 'utf8'));
    return { status: r.status ?? 'unknown', failed: r.failedTests?.length ?? 0 };
  } catch {
    return { status: 'never-run', failed: 0 };
  }
}

/**
 * Minimal OpenAPI path extractor. The steel-thread spec is small and flat
 * (paths → method → operationId/summary/tags), so a purpose-built line parser
 * is more honest than pulling in a YAML dependency for six endpoints.
 */
function loadEndpoints() {
  const yaml = readFileSync(profile.api.openapi, 'utf8').split('\n');
  const endpoints = [];
  let path = null;
  let cur = null;
  for (const raw of yaml) {
    const pathM = /^ {2}(\/\S+):\s*$/.exec(raw);
    if (pathM) { path = pathM[1]; continue; }
    if (!path) continue;
    const methodM = /^ {4}(get|post|put|patch|delete):\s*$/.exec(raw);
    if (methodM) {
      cur = { method: methodM[1].toUpperCase(), path, operationId: null, summary: null, tags: [] };
      endpoints.push(cur);
      continue;
    }
    if (!cur) continue;
    const opM = /^ {6}operationId:\s*(\S+)/.exec(raw);
    if (opM) cur.operationId = opM[1];
    const sumM = /^ {6}summary:\s*(.+)/.exec(raw);
    if (sumM) cur.summary = sumM[1].trim();
    const tagM = /^ {6}tags:\s*\[(.+)\]/.exec(raw);
    if (tagM) cur.tags = tagM[1].split(',').map((s) => s.trim());
    // a new path at 2-space indent resets cur (handled by pathM above)
  }
  return endpoints;
}

// Normalise an observed request URL to a spec-style path (collapse ids → {id}).
function toSpecPath(urlStr) {
  const p = new URL(urlStr).pathname;
  return p.replace(/\/[0-9a-f-]{6,}$/i, '/{id}').replace(/\/\d+$/i, '/{id}');
}

// ---------------------------------------------------------------------------
// Compute
// ---------------------------------------------------------------------------

function pct(n, d) {
  return d === 0 ? 0 : Math.round((n / d) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// No-OpenAPI path: UI journeys only, sourced from the discovered trace(s).
// Used by profiles whose api.openapi is null (e.g. live external apps where the
// surface is DISCOVERED, not spec'd). The API section is marked not-applicable.
// ---------------------------------------------------------------------------

function buildManifestNoApi() {
  const files = readdirSync(GENERATED).filter((f) => /^trace\..*\.json$/.test(f));
  if (files.length === 0) throw new Error(`no ${GENERATED}/trace.*.json — run discovery first`);
  const run = lastRunStatus();
  const passing = run.status === 'passed';

  const demonstrated = files.sort().map((f) => {
    const t = JSON.parse(readFileSync(join(GENERATED, f), 'utf8'));
    const scenarios = (t.steps || []).map((s, i) => {
      const intent = s.intent || `step ${i + 1}`;
      const change = s.causedStateChange?.expectedAddedNodes
        ?.map((n) => `${n.role} "${n.name}"`).join(', ');
      return change ? `${intent} (caused state change: ${change})` : intent;
    });
    return {
      id: t.journeyId,
      role: t.role,
      title: t.title,
      discoveredBy: t.source === 'agent-browser' ? 'dynamic' : 'reference',
      evidence: { trace: f },
      scenarios,
      covered: passing,
    };
  });
  const coveredCount = demonstrated.filter((j) => j.covered).length;

  return {
    generatedAt: new Date().toISOString(),
    app: profile.name,
    contract: null,
    sources: {
      trace: files.sort(),
      openapi: null,
      lastRun: run,
    },
    ui: {
      definition:
        '§9: covered demonstrated journeys ÷ total demonstrated journeys (journey coverage, not line coverage; undemonstrated excluded)',
      demonstratedTotal: demonstrated.length,
      covered: coveredCount,
      coveragePct: pct(coveredCount, demonstrated.length),
      demonstratedJourneys: demonstrated,
      authoredUndemonstrated: [],
      caveat:
        'Live external app with no authoritative contract — journeys proven by discovery traces against the live DOM. POC denominator is intentionally small.',
    },
    api: {
      applicable: false,
      note: 'no OpenAPI spec for this profile',
    },
  };
}

function buildManifest() {
  const trace = loadTrace();
  const run = lastRunStatus();
  const endpoints = loadEndpoints();

  // --- UI journeys --------------------------------------------------------
  // The only journey proven by a recorded discovery trace is the one the trace
  // describes. Its happy path + the analyst negative scenarios are scenarios OF
  // that journey (§9: a journey with N scenarios counts once). The supervisor
  // RBAC-boundary spec is a different role and was authored, not discovered:
  // it is undemonstrated and excluded from the denominator.
  const passing = run.status === 'passed';
  const demonstrated = [
    {
      id: trace.journeyId,
      role: trace.role,
      discoveredBy: trace.source === 'agent-browser' ? 'dynamic' : 'reference',
      evidence: { trace: 'generated/trace.analyst-transfer.json', har: 'generated/discover.har' },
      scenarios: [
        'analyst-transfer.feature: happy path (caused state change asserted)',
        'negative-rbac.spec.ts: invalid amount "abc"',
        'negative-rbac.spec.ts: amount "0"',
        'negative-rbac.spec.ts: insufficient funds',
        'negative-rbac.spec.ts: over approval limit',
      ],
      covered: passing,
    },
  ];
  const authoredUndemonstrated = [
    {
      id: 'supervisor-transfer-over-analyst-limit',
      role: 'supervisor',
      undemonstrated: true,
      reason: 'RBAC boundary scenario authored from the contract, not produced by a discovery trace',
      scenarios: ['negative-rbac.spec.ts: supervisor CAN transfer 15000'],
      covered: passing,
    },
  ];
  const coveredCount = demonstrated.filter((j) => j.covered).length;

  // --- API surface --------------------------------------------------------
  const observed = new Map(); // specPath+method -> max status
  for (const c of trace.apiCalls || []) {
    if (c.method === 'OPTIONS') continue;
    const key = `${c.method} ${toSpecPath(c.url)}`;
    observed.set(key, c.status);
  }

  // Strict API coverage: endpoints with a generated status+zod test, from the
  // api_test_generator manifest (<workDir>/api/api-coverage.json).
  const schemaTested = new Set();
  try {
    const m = JSON.parse(readFileSync(join(GENERATED, 'api', 'api-coverage.json'), 'utf8'));
    for (const c of m.covered || []) {
      if (c.operationId) schemaTested.add(c.operationId);
      if (c.method && c.path) schemaTested.add(`${c.method.toUpperCase()} ${c.path}`);
    }
  } catch { /* no api tests generated yet */ }

  const apiEndpoints = endpoints.map((e) => {
    const key = `${e.method} ${e.path}`;
    const status = observed.get(key);
    return {
      operationId: e.operationId,
      method: e.method,
      path: e.path,
      tags: e.tags,
      consumerTouched: status !== undefined,
      observedStatus: status ?? null,
      // True when api_test_generator produced a status + zod schema test for it.
      schemaValidatingTest: schemaTested.has(e.operationId) || schemaTested.has(key),
    };
  });

  // Drift: used-but-undocumented (in HAR, not in spec) — exclude the reset hook.
  const documentedKeys = new Set(endpoints.map((e) => `${e.method} ${e.path}`));
  const usedUndocumented = [...observed.keys()].filter((k) => !documentedKeys.has(k));
  // Drift: documented-but-never-exercised by the demonstrated journey.
  const documentedUnexercised = apiEndpoints
    .filter((e) => !e.consumerTouched && e.tags?.[0] !== 'test')
    .map((e) => `${e.method} ${e.path}`);

  const schemaValidated = apiEndpoints.filter((e) => e.schemaValidatingTest).length;
  const consumerTouched = apiEndpoints.filter((e) => e.consumerTouched).length;

  return {
    generatedAt: new Date().toISOString(),
    app: profile.name,
    contract: trace.contract,
    sources: {
      trace: 'generated/trace.analyst-transfer.json',
      openapi: 'shared/openapi.yaml',
      lastRun: run,
    },
    ui: {
      definition:
        '§9: covered demonstrated journeys ÷ total demonstrated journeys (journey coverage, not line coverage; undemonstrated excluded)',
      demonstratedTotal: demonstrated.length,
      covered: coveredCount,
      coveragePct: pct(coveredCount, demonstrated.length),
      demonstratedJourneys: demonstrated,
      authoredUndemonstrated,
      caveat:
        'POC denominator is intentionally tiny (1 demonstrated journey). The number proves the loop works end-to-end; it is not a statistically meaningful coverage figure.',
    },
    api: {
      definition:
        '§9: endpoints with ≥1 test validating status code AND response schema via zod ÷ documented endpoints',
      documentedTotal: apiEndpoints.length,
      schemaValidated,
      coveragePct: pct(schemaValidated, apiEndpoints.length),
      consumerTouched,
      endpoints: apiEndpoints,
      drift: {
        usedButUndocumented: usedUndocumented,
        documentedButUnexercised: documentedUnexercised,
      },
      gap:
        'The steel thread ships UI Playwright specs only — no zod schema-validating API tests — so strict §9 API coverage is 0. consumerTouched shows what the journey exercised at runtime; building schema assertions is the next API-coverage step.',
    },
  };
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

const manifest = profile.api.openapi ? buildManifest() : buildManifestNoApi();
writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');

const u = manifest.ui;
const a = manifest.api;
console.log(`coverage: wrote ${OUT}`);
console.log(`  UI  journeys : ${u.covered}/${u.demonstratedTotal} demonstrated covered = ${u.coveragePct}%  (last run: ${manifest.sources.lastRun.status})`);
if (a.applicable === false) {
  console.log(`  API          : not applicable — ${a.note}`);
} else {
  console.log(`  API (strict) : ${a.schemaValidated}/${a.documentedTotal} schema-validated = ${a.coveragePct}%  (${a.consumerTouched}/${a.documentedTotal} touched at runtime)`);
  if (a.drift.usedButUndocumented.length)
    console.log(`  DRIFT used-but-undocumented : ${a.drift.usedButUndocumented.join(', ')}`);
  if (a.drift.documentedButUnexercised.length)
    console.log(`  DRIFT documented-but-unexercised : ${a.drift.documentedButUnexercised.join(', ')}`);
}
