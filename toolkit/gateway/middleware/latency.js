// middleware/latency.js — per-call latency capture (plan §21.5 metric #3, partial:
// model-call latency; scope-detect latency needs scope_detector, not built).
//
// Records the provider-call wall-clock for every request, keyed by tier (and
// repo), and computes p50/p95/p99 on demand. The blocking-path budget claims
// (§15: 30s model timeout + fail-open) are only checkable against real numbers —
// this is where they come from. In-memory, POC-level.

const samples = new Map(); // key -> number[] (ms)

function push(key, ms) {
  let arr = samples.get(key);
  if (!arr) { arr = []; samples.set(key, arr); }
  arr.push(ms);
}

export function record({ tier, repo, ms }) {
  push(`tier:${tier}`, ms);
  push(`repo:${repo}`, ms);
}

// Nearest-rank percentile.
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

function stats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const round = (x) => (x === null ? null : Math.round(x));
  return {
    count: s.length,
    min: round(s[0] ?? null),
    p50: round(percentile(s, 50)),
    p95: round(percentile(s, 95)),
    p99: round(percentile(s, 99)),
    max: round(s[s.length - 1] ?? null),
  };
}

export function snapshot() {
  return Object.fromEntries([...samples.entries()].map(([k, arr]) => [k, stats(arr)]));
}
