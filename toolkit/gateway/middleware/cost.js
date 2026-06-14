// middleware/cost.js — per-repo cost attribution (R5, for the §17 KPI dashboard).
// Estimated $ from token usage × the config price table. Clearly an estimate.

import { priceFor } from '../config.js';

const ledger = new Map(); // repo -> { requests, inputTokens, outputTokens, costUsd, byModel }

export function estimate(binding, usage) {
  const p = priceFor(binding);
  const cost =
    (usage.input_tokens / 1_000_000) * p.inputPer1M +
    (usage.output_tokens / 1_000_000) * p.outputPer1M;
  return Math.round(cost * 1e6) / 1e6; // 6dp
}

export function record(repo, binding, usage, costUsd) {
  let e = ledger.get(repo);
  if (!e) {
    e = { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byModel: {} };
    ledger.set(repo, e);
  }
  e.requests += 1;
  e.inputTokens += usage.input_tokens;
  e.outputTokens += usage.output_tokens;
  e.costUsd = Math.round((e.costUsd + costUsd) * 1e6) / 1e6;
  e.byModel[binding] = (e.byModel[binding] || 0) + 1;
}

export function snapshot() {
  return {
    note: 'cost is an ESTIMATE from config price table × token usage, not billed (§17/§21.2).',
    repos: Object.fromEntries(ledger),
  };
}
