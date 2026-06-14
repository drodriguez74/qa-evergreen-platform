#!/usr/bin/env node
/**
 * latency_eval.mjs — model-call latency (POC metric #3, plan §21.5 — partial).
 *
 * §21.5 #3 is "scope-detect / model p99 latency." The scope-detect half needs
 * `scope_detector` (git-diff → test tags), which isn't built. The MODEL-CALL half
 * is measurable now that every call goes through the gateway: this harness drives
 * N small calls on the FAST tier (the high-frequency, latency-sensitive tier —
 * healer/narrator/stubs) and reports p50/p95/p99 from the gateway-measured
 * provider wall-clock, plus the client round-trip for comparison.
 *
 * This is what the §15 blocking-path budget claims (30s model timeout + fail-open)
 * must be checked against. Env: STEEL_THREAD_LATENCY_RUNS (default 30),
 * QA_GATEWAY_URL (default http://localhost:4100).
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { loadProfile } from '../../../toolkit/profile.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'generated', 'latency-eval.json');

const profile = loadProfile();
const N = Number(process.env.STEEL_THREAD_LATENCY_RUNS || 30);
const WARMUP = 3;
const GATEWAY_URL = profile.gateway.url;
const REPO = `${profile.name}-latency`;

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return Math.round(sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]);
}

function stats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return {
    count: s.length,
    min: Math.round(s[0]),
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
    max: Math.round(s[s.length - 1]),
  };
}

async function oneCall() {
  const t0 = performance.now();
  const res = await fetch(`${GATEWAY_URL}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      repo: REPO,
      tier: 'fast',
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      max_tokens: 8,
      payload_types: ['latency-probe'],
    }),
  });
  const roundTripMs = performance.now() - t0;
  if (!res.ok) throw new Error(`gateway ${res.status}`);
  const data = await res.json();
  return { provider: data.latency_ms, roundTrip: roundTripMs };
}

async function gatewayFastReady() {
  try {
    const h = await (await fetch(`${GATEWAY_URL}/healthz`)).json();
    const provider = (h.tiers?.fast || '').split(':')[0];
    return { ready: Boolean(h.providers?.[provider]), binding: h.tiers?.fast };
  } catch { return { ready: false }; }
}

async function main() {
  const { ready, binding } = await gatewayFastReady();
  if (!ready) {
    console.error(`latency-eval: ABORT — model gateway not ready at ${GATEWAY_URL}.`);
    console.error('             Start it: (cd toolkit/gateway && npm install && npm start)');
    process.exit(2);
  }

  console.log(`latency-eval: ${WARMUP} warm-up + ${N} measured fast-tier calls (${binding}) via ${GATEWAY_URL}...`);
  for (let i = 0; i < WARMUP; i++) await oneCall();

  const provider = [];
  const roundTrip = [];
  for (let i = 0; i < N; i++) {
    const r = await oneCall();
    provider.push(r.provider);
    roundTrip.push(r.roundTrip);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    metric: 'Model-call latency (§21.5 #3, model half)',
    tier: binding,
    via: `model gateway (${GATEWAY_URL})`,
    samples: N,
    warmupDiscarded: WARMUP,
    providerCallMs: stats(provider),   // gateway-measured provider wall-clock
    roundTripMs: stats(roundTrip),     // client → gateway → provider → client
    budgetRef: 'plan §15: blocking-path agents fail open within a 30s model timeout + 1 retry',
    caveat:
      `Single fast-tier model on localhost; ${N} samples make p50/p95 solid but p99 indicative only. ` +
      'The scope-detect half of §21.5 #3 (git-diff → test tags) needs scope_detector, which is not built.',
  };
  writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');

  const p = report.providerCallMs;
  console.log('latency-eval: wrote generated/latency-eval.json');
  console.log(`  provider call ms — p50=${p.p50}  p95=${p.p95}  p99=${p.p99}  (min=${p.min} max=${p.max}, n=${p.count})`);
  console.log(`  round-trip ms    — p50=${report.roundTripMs.p50}  p95=${report.roundTripMs.p95}  p99=${report.roundTripMs.p99}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
