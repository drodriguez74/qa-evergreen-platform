// config.js — gateway configuration: tier→provider:model bindings, price table,
// and per-repo quota budgets. All overridable by environment variable so the
// §21.2 bake-off (and per-repo overrides, §17) are config, never code changes.

/**
 * Two tiers (plan §17 / §21.2). Form is `provider:model` so flipping the
 * bake-off is one env var:
 *   QA_MODEL_REASONING=azure:gpt-5.2   vs   anthropic:claude-sonnet-4-6
 */
export const TIERS = {
  reasoning: process.env.QA_MODEL_REASONING || 'anthropic:claude-sonnet-4-6',
  fast: process.env.QA_MODEL_FAST || 'anthropic:claude-haiku-4-5',
};

/**
 * Price table ($ per 1M tokens). Anthropic figures from plan §21.2; others are
 * placeholders until a rate is confirmed. Used for per-repo cost attribution
 * (§17 KPI dashboard) — an estimate, clearly labelled, never billed.
 */
export const PRICES = {
  'anthropic:claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15, source: 'plan §21.2' },
  'anthropic:claude-haiku-4-5': { inputPer1M: 1, outputPer1M: 5, source: 'estimate' },
  'azure:gpt-5.2-codex-2026-01-22': { inputPer1M: 0, outputPer1M: 0, source: 'TBD — confirm with Azure rep (§21.2)' },
};

/**
 * Per-repo quota (R4). In-memory rolling window. POC-level: simple budget that
 * proves the chokepoint. Fair-share distribution across many repos is SCALE.
 */
export const QUOTA = {
  windowMs: Number(process.env.QA_QUOTA_WINDOW_MS || 60 * 60 * 1000), // 1h
  maxRequests: Number(process.env.QA_REPO_MAX_REQUESTS || 200),
  maxTokens: Number(process.env.QA_REPO_TOKEN_BUDGET || 2_000_000),
};

export const PORT = Number(process.env.QA_GATEWAY_PORT || 4100);

// Per-call resilience (R8): timeout + one retry; on exhaustion the caller gets
// 502 and degrades to its deterministic fallback.
export const CALL_TIMEOUT_MS = Number(process.env.QA_GATEWAY_TIMEOUT_MS || 60_000);
export const CALL_RETRIES = Number(process.env.QA_GATEWAY_RETRIES || 1);

export function resolveTier(tier) {
  const binding = TIERS[tier];
  if (!binding) throw new Error(`unknown tier "${tier}" (expected: ${Object.keys(TIERS).join(', ')})`);
  const [provider, ...rest] = binding.split(':');
  return { provider, model: rest.join(':'), binding };
}

export function priceFor(binding) {
  return PRICES[binding] || { inputPer1M: 0, outputPer1M: 0, source: 'unknown' };
}
