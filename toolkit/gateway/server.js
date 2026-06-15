// server.js — QA Evergreen model gateway (POC). Plan §21.4 first [POC] lynchpin.
//
// The single chokepoint every agent calls instead of a vendor SDK (R1). It:
//   - holds the provider credential, never returns it (R3)
//   - routes the two tiers to a provider+model, per-repo overridable (R2)
//   - enforces a per-repo quota (R4) and attributes cost per repo (R5)
//   - writes a payload-type audit line per call (R6)
//   - passes through strict structured output (R7)
//   - times out + retries, surfacing 502 so callers degrade gracefully (R8)
//
// Local HTTP on :4100 for the POC; the agent-facing contract is identical to the
// eventual platform/qa-toolkit service, so the host can change without touching
// agent code. Run: node server.js
//
// Credential loading: process.env first, then gateway .env, then steel-thread/.env
// (where the POC key already lives) — so `npm start` works out of the box.

import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';

import { PORT, CALL_TIMEOUT_MS, CALL_RETRIES, TIERS, resolveTier, priceFor } from './config.js';
import { getAdapter, providerReadiness } from './adapters/index.js';
import * as credentials from './credentials.js';
import * as quota from './middleware/quota.js';
import * as cost from './middleware/cost.js';
import * as audit from './middleware/audit.js';
import * as latency from './middleware/latency.js';
import { performance } from 'node:perf_hooks';

// Credential source is now pluggable (credentials.js). The `env` provider (default)
// owns the historical .env cascade — process.env, then gateway .env, then
// steel-thread/.env — so behavior is unchanged. preload() warms remote providers
// (e.g. azure-keyvault) so the adapters' sync ready()/get() can serve from cache;
// it is a no-op for `env`.
await credentials.preload(['ANTHROPIC_API_KEY', 'AZURE_OPENAI_API_KEY']);

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));

// --- helpers ---------------------------------------------------------------

// Validate messages[].content, accepting EITHER a plain string (the historical
// shape the whole pipeline uses) OR an array of content blocks for multimodal
// (vision) prompts. Returns an error string on a bad shape, or null when valid.
// Block shapes (Anthropic-native; the azure adapter maps them on the way out):
//   { type: 'text',  text }
//   { type: 'image', source: { type: 'base64', media_type, data } }
function validateMessages(messages) {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || typeof m !== 'object' || Array.isArray(m)) {
      return `messages[${i}] must be an object`;
    }
    if (!m.role) return `messages[${i}] missing "role"`;
    const { content } = m;

    if (typeof content === 'string') continue;     // historical path — unchanged
    if (!Array.isArray(content)) {
      return `messages[${i}].content must be a string or an array of content blocks`;
    }
    if (content.length === 0) {
      return `messages[${i}].content array must not be empty`;
    }
    for (let j = 0; j < content.length; j++) {
      const b = content[j];
      const at = `messages[${i}].content[${j}]`;
      if (!b || typeof b !== 'object' || Array.isArray(b)) {
        return `${at} must be a content block object`;
      }
      if (b.type === 'text') {
        if (typeof b.text !== 'string') return `${at} (text) requires a string "text"`;
      } else if (b.type === 'image') {
        const s = b.source;
        if (!s || typeof s !== 'object') return `${at} (image) requires a "source" object`;
        if (s.type !== 'base64') return `${at} (image) source.type must be "base64"`;
        if (typeof s.media_type !== 'string') return `${at} (image) source.media_type must be a string`;
        if (typeof s.data !== 'string') return `${at} (image) source.data must be a base64 string`;
      } else {
        return `${at} has unsupported block type "${b.type}" (expected "text" or "image")`;
      }
    }
  }
  return null;
}

async function withTimeoutAndRetry(fn) {
  let lastErr;
  for (let attempt = 0; attempt <= CALL_RETRIES; attempt++) {
    try {
      return await Promise.race([
        fn(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('gateway call timed out')), CALL_TIMEOUT_MS)),
      ]);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// --- routes ----------------------------------------------------------------

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, tiers: TIERS, providers: providerReadiness(), credentialProvider: credentials.providerName(), vision: true });
});

app.get('/v1/usage', (_req, res) => {
  res.json({ cost: cost.snapshot(), quota: quota.snapshot(), latency: latency.snapshot(), auditLog: audit.AUDIT_PATH, credentialProvider: credentials.providerName() });
});

app.post('/v1/messages', async (req, res) => {
  const requestId = randomUUID();
  const { repo, tier, system, messages, tool, tool_choice, max_tokens, payload_types } = req.body || {};

  // Validate the neutral request.
  if (!repo) return res.status(400).json({ error: 'missing "repo"', requestId });
  if (!tier) return res.status(400).json({ error: 'missing "tier"', requestId });
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'missing "messages"', requestId });
  }
  // R7-adjacent: accept string OR multimodal content-block arrays; reject bad shapes (400).
  const badMessages = validateMessages(messages);
  if (badMessages) return res.status(400).json({ error: badMessages, requestId });

  let provider, model, binding;
  try {
    ({ provider, model, binding } = resolveTier(tier));
  } catch (err) {
    return res.status(400).json({ error: String(err.message), requestId });
  }

  // Provider availability (R8 — surfaces as 502 so callers fall back).
  let adapter;
  try {
    adapter = getAdapter(provider);
  } catch (err) {
    return res.status(400).json({ error: String(err.message), requestId });
  }
  if (!adapter.ready()) {
    return res.status(502).json({ error: 'provider_unavailable', provider, binding, requestId });
  }

  // Per-repo quota (R4).
  const denied = quota.check(repo);
  if (denied) return res.status(429).json({ ...denied, requestId });
  quota.reserve(repo);

  // Dispatch (R7 structured output passes straight through).
  try {
    const t0 = performance.now();
    const { output, usage } = await withTimeoutAndRetry(() =>
      adapter.complete({ model, system, messages, tool, tool_choice, max_tokens }),
    );
    const latencyMs = Math.round(performance.now() - t0);

    const totalTokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);
    quota.record(repo, totalTokens);
    const costUsd = cost.estimate(binding, usage);
    cost.record(repo, binding, usage, costUsd);
    latency.record({ tier, repo, ms: latencyMs });
    audit.log({
      requestId, repo, tier, provider, model,
      payload_types: payload_types || [],            // R6: types only, never content
      usage, cost_usd: costUsd, latency_ms: latencyMs, outcome: 'ok',
    });

    res.json({ output, provider, model, usage, cost_usd: costUsd, latency_ms: latencyMs, request_id: requestId });
  } catch (err) {
    audit.log({ requestId, repo, tier, provider, model, payload_types: payload_types || [], outcome: 'error', error: String(err.message) });
    res.status(502).json({ error: 'provider_call_failed', detail: String(err.message), provider, requestId });
  }
});

app.listen(PORT, () => {
  const r = providerReadiness();
  console.log(`qa-model-gateway: listening on http://localhost:${PORT}`);
  console.log(`  tiers: reasoning=${TIERS.reasoning}  fast=${TIERS.fast}`);
  console.log(`  credential provider: ${credentials.providerName()}`);
  console.log(`  providers ready: ${Object.entries(r).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  console.log(`  audit log: ${audit.AUDIT_PATH}`);
});
