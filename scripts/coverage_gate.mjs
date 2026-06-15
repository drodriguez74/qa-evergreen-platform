#!/usr/bin/env node
/**
 * coverage_gate.mjs — the merge-blocking coverage gate (plan Layer 4 / §11).
 *
 * Reads a profile's coverage-manifest.json (produced by metrics/coverage.mjs) and
 * exits non-zero if UI or strict-API coverage is below the floor — so CI can block
 * a merge. Floor defaults to 50 (QA_DEFAULT_COVERAGE_GATE in the plan); override
 * with QA_COVERAGE_GATE. API gate is skipped for profiles without an OpenAPI spec.
 *
 * Usage: QA_PROFILE=<name> [QA_COVERAGE_GATE=50] node scripts/coverage_gate.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadProfile } from '../toolkit/profile.mjs';

const FLOOR = Number(process.env.QA_COVERAGE_GATE || 50);
const profile = loadProfile();
const manifestPath = join(profile.workDir, 'coverage-manifest.json');

let m;
try {
  m = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch {
  console.error(`coverage-gate: no manifest at ${manifestPath} — run \`npm run metrics:coverage\` first.`);
  process.exit(2);
}

const ui = m.ui?.coveragePct ?? 0;
const apiApplicable = m.api && m.api.applicable !== false && m.api.coveragePct != null;
const api = apiApplicable ? m.api.coveragePct : null;

const checks = [{ name: 'UI', pct: ui }];
if (apiApplicable) checks.push({ name: 'API (strict)', pct: api });

let failed = false;
console.log(`coverage-gate: ${profile.name} — floor ${FLOOR}%`);
for (const c of checks) {
  const ok = c.pct >= FLOOR;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${c.name}: ${c.pct}%`);
  if (!ok) failed = true;
}
if (!apiApplicable) console.log('  (API gate skipped — no OpenAPI spec for this profile)');

console.log(failed ? `coverage-gate: BLOCKED (below ${FLOOR}%)` : 'coverage-gate: passed');
process.exit(failed ? 1 : 0);
