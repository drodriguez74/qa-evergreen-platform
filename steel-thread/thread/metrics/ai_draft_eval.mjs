#!/usr/bin/env node
/**
 * ai_draft_eval.mjs — AI-draft false-positive rate (POC metric #1, plan §21.5).
 *
 * The claim under test: "the AI drafts the test, a human just reviews." This
 * harness measures how often the model-mode trace compiler produces a draft that
 * would need *substantial* human rework before it could be trusted.
 *
 * Method (black-box, non-destructive):
 *   1. Back up the committed generated artifacts.
 *   2. K times: run the REAL `node trace_compiler.mjs` with ANTHROPIC_API_KEY set
 *      (so it takes the model path, model claude-sonnet-4-6, strict tool use),
 *      move its output (feature + spec + pages) into metrics/runs/model-{k}/, and
 *      restore the committed baseline so each run starts clean and the repo is
 *      never left mutated.
 *   3. Evaluate each run IN ISOLATION (only that run's spec + page objects, not
 *      the sibling negative-rbac spec the model never saw) against four gates that
 *      encode "trustworthy without rework":
 *        G1 typecheck   — the artifacts compile (tsc --noEmit, isolated tsconfig)
 *        G2 locators    — role + accessible name only; no getByTestId/.locator()/
 *                         data-testid/@ref (the a11y-contract rule)
 *        G3 assertion bar — asserts the CAUSED state change: "Transfer Complete"
 *                         AND a "Transaction ID" check (not just navigation)
 *        G4 completeness — feature + a runnable spec importing ≥1 page + ≥4 POMs
 *   4. A run "needs rework" if ANY gate fails. False-positive rate =
 *      runs-needing-rework / model-runs.
 *
 * If the model is unreachable the compiler falls back to deterministic output;
 * that is detected and NOT counted as a model run (the metric would be meaningless).
 *
 * Runs default to 5; override with STEEL_THREAD_AI_RUNS=N. Requires the key in
 * steel-thread/.env or the environment.
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProfile } from '../../../toolkit/profile.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const THREAD = join(__dirname, '..');
const GENERATED = join(THREAD, 'generated');
const PAGES = join(GENERATED, 'pages');
const BACKUP = join(__dirname, '.backup');
const RUNS = join(__dirname, 'runs');
const OUT = join(GENERATED, 'ai-draft-eval.json');

const FEATURE = 'analyst-transfer.feature';
const SPEC = 'analyst-transfer.spec.ts';
const RUN_COUNT = Number(process.env.STEEL_THREAD_AI_RUNS || 5);
const GATEWAY_URL = loadProfile().gateway.url;

// ---------------------------------------------------------------------------
// Baseline backup / restore (so the committed artifacts survive untouched)
// ---------------------------------------------------------------------------

function snapshotGeneratedArtifacts(dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(join(dest, 'pages'), { recursive: true });
  cpSync(join(GENERATED, FEATURE), join(dest, FEATURE));
  cpSync(join(GENERATED, SPEC), join(dest, SPEC));
  for (const f of readdirSync(PAGES)) cpSync(join(PAGES, f), join(dest, 'pages', f));
}

function restoreBaseline() {
  rmSync(PAGES, { recursive: true, force: true });
  mkdirSync(PAGES, { recursive: true });
  cpSync(join(BACKUP, FEATURE), join(GENERATED, FEATURE));
  cpSync(join(BACKUP, SPEC), join(GENERATED, SPEC));
  for (const f of readdirSync(join(BACKUP, 'pages'))) cpSync(join(BACKUP, 'pages', f), join(PAGES, f));
}

// ---------------------------------------------------------------------------
// Gates — evaluate one run directory in isolation
// ---------------------------------------------------------------------------

const FORBIDDEN_LOCATORS = [/getByTestId/, /\.locator\(/, /data-testid/, /@ref\b/, /getByText\(\s*['"`]#/];

function readAll(runDir) {
  const specPath = join(runDir, SPEC);
  const spec = existsSync(specPath) ? readFileSync(specPath, 'utf8') : '';
  const pagesDir = join(runDir, 'pages');
  const pageFiles = existsSync(pagesDir) ? readdirSync(pagesDir).filter((f) => f.endsWith('.ts')) : [];
  const pages = pageFiles.map((f) => readFileSync(join(pagesDir, f), 'utf8'));
  const featurePath = join(runDir, FEATURE);
  const feature = existsSync(featurePath) ? readFileSync(featurePath, 'utf8') : '';
  return { spec, pages, pageFiles, feature, combined: [spec, ...pages].join('\n') };
}

function gateTypecheck(runDir) {
  // Isolated tsconfig: only this run's spec + pages. node_modules resolves upward
  // (runDir lives under thread/, whose node_modules has @playwright/test + typescript).
  const cfg = {
    compilerOptions: {
      target: 'ES2021', module: 'ESNext', moduleResolution: 'bundler',
      lib: ['ES2021', 'DOM'], strict: true, noEmit: true,
      esModuleInterop: true, skipLibCheck: true, types: ['node'],
    },
    include: ['*.spec.ts', 'pages/*.ts'],
  };
  writeFileSync(join(runDir, 'tsconfig.eval.json'), JSON.stringify(cfg, null, 2));
  const r = spawnSync('npx', ['tsc', '--noEmit', '-p', join(runDir, 'tsconfig.eval.json')], {
    cwd: THREAD, encoding: 'utf8',
  });
  return { pass: r.status === 0, detail: r.status === 0 ? '' : (r.stdout || r.stderr || '').trim().split('\n').slice(0, 4).join(' | ') };
}

function evaluateRun(runDir) {
  const a = readAll(runDir);
  const gates = {};

  gates.typecheck = gateTypecheck(runDir);

  const offending = FORBIDDEN_LOCATORS.filter((re) => re.test(a.combined)).map(String);
  gates.locators = { pass: offending.length === 0, detail: offending.join(', ') };

  const hasCausedHeading = /Transfer Complete/.test(a.combined);
  const hasTxnId = /Transaction ID/.test(a.combined);
  gates.assertionBar = {
    pass: hasCausedHeading && hasTxnId,
    detail: `Transfer Complete=${hasCausedHeading}, Transaction ID=${hasTxnId}`,
  };

  const importsPage = /from ['"]\.\/pages\//.test(a.spec);
  const hasTest = /\btest\s*\(/.test(a.spec);
  gates.completeness = {
    pass: a.feature.trim().length > 0 && importsPage && hasTest && a.pageFiles.length >= 4,
    detail: `feature=${a.feature.trim().length > 0}, importsPage=${importsPage}, hasTest=${hasTest}, pages=${a.pageFiles.length}`,
  };

  const failed = Object.entries(gates).filter(([, g]) => !g.pass).map(([k]) => k);
  return { gates, needsRework: failed.length > 0, failedGates: failed };
}

// ---------------------------------------------------------------------------
// One model compile
// ---------------------------------------------------------------------------

function runCompiler() {
  const r = spawnSync('node', ['trace_compiler.mjs'], {
    cwd: THREAD, encoding: 'utf8',
    env: { ...process.env }, // no key here — the gateway holds the credential (R3)
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const usedModel = /mode = gateway/.test(out) && !/deterministic fallback/.test(out);
  return { ok: r.status === 0, usedModel, out };
}

async function gatewayReasoningReady() {
  try {
    const res = await fetch(`${GATEWAY_URL}/healthz`);
    if (!res.ok) return false;
    const h = await res.json();
    const provider = (h.tiers?.reasoning || '').split(':')[0];
    return Boolean(h.providers?.[provider]);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!(await gatewayReasoningReady())) {
    console.error(`ai-draft-eval: ABORT — model gateway not ready at ${GATEWAY_URL}.`);
    console.error('               This metric measures the MODEL path; deterministic fallback would be meaningless.');
    console.error('               Start it: (cd toolkit/gateway && npm install && npm start)');
    process.exit(2);
  }

  console.log(`ai-draft-eval: ${RUN_COUNT} model-mode compiles of the analyst-transfer trace (via gateway ${GATEWAY_URL})...`);
  snapshotGeneratedArtifacts(BACKUP);
  rmSync(RUNS, { recursive: true, force: true });
  mkdirSync(RUNS, { recursive: true });

  const runs = [];
  let modelRuns = 0;
  try {
    for (let k = 1; k <= RUN_COUNT; k++) {
      restoreBaseline();                      // clean slate per run
      const compile = runCompiler();
      const runDir = join(RUNS, `model-${k}`);
      snapshotGeneratedArtifacts(runDir);     // capture whatever it produced

      if (!compile.usedModel) {
        console.log(`  run ${k}: model NOT used (fell back to deterministic) — excluded from the metric`);
        runs.push({ run: k, usedModel: false, compileOk: compile.ok });
        continue;
      }
      modelRuns++;
      const evald = evaluateRun(runDir);
      runs.push({ run: k, usedModel: true, compileOk: compile.ok, ...evald });
      const verdict = evald.needsRework ? `NEEDS REWORK (${evald.failedGates.join(',')})` : 'clean';
      console.log(`  run ${k}: ${verdict}`);
    }
  } finally {
    restoreBaseline();                        // leave the repo exactly as found
  }

  const reworked = runs.filter((r) => r.usedModel && r.needsRework).length;
  const fpRate = modelRuns === 0 ? null : Math.round((reworked / modelRuns) * 1000) / 10;

  let binding = 'unknown';
  try { binding = (await (await fetch(`${GATEWAY_URL}/healthz`)).json()).tiers?.reasoning || 'unknown'; } catch { /* keep unknown */ }

  const result = {
    generatedAt: new Date().toISOString(),
    metric: 'AI-draft false-positive rate (§21.5 #1)',
    via: `model gateway (${GATEWAY_URL})`,
    reasoningTier: binding, // provider:model the gateway routed to (flip for the §21.2 bake-off)
    journey: 'analyst-transfer-happy-path',
    gates: ['typecheck', 'locators', 'assertionBar', 'completeness'],
    requested: RUN_COUNT,
    modelRuns,
    needingRework: reworked,
    falsePositiveRatePct: fpRate,
    caveat:
      'Single journey, small N. This validates the harness and gives a first real number; a defensible rate needs more journeys and the provider bake-off (§21.2).',
    runs,
  };
  writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');

  console.log(`ai-draft-eval: wrote generated/ai-draft-eval.json`);
  console.log(`  model runs: ${modelRuns}/${RUN_COUNT}   needing rework: ${reworked}   false-positive rate: ${fpRate === null ? 'n/a' : fpRate + '%'}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
