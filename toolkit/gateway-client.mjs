// gateway-client.mjs — resilient client for the model gateway.
//
// Agents call the gateway over HTTP (the agent→gateway hop). That hop had NO
// retry, so a transient transport error ("fetch failed") or a 5xx/429 aborted a
// whole run. This wraps POST /v1/messages with retry + exponential backoff on
// retryable failures (transport errors, 429, 5xx); 4xx (bad request) fails fast.
// Complements the gateway's own provider-call retry (gateway→model).
//
// Usage:  import { callGateway } from '../gateway-client.mjs';
//         const data = await callGateway(profile.gateway.url, body);  // throws on exhaustion
//         const out  = data.output;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POST a neutral request to <gatewayUrl>/v1/messages with retry/backoff.
 * @returns parsed JSON ({ output, usage, ... }). Throws after exhausting retries.
 */
export async function callGateway(gatewayUrl, body, { retries = 3, baseDelayMs = 400 } = {}) {
  const url = `${gatewayUrl.replace(/\/$/, '')}/v1/messages`;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) return await res.json();

      const text = await res.text().catch(() => '');
      // 429 / 5xx are transient → retry; other 4xx are caller errors → fail fast.
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        lastErr = new Error(`gateway ${res.status}: ${text.slice(0, 160)}`);
      } else {
        throw new Error(`gateway ${res.status}: ${text.slice(0, 200)}`);
      }
    } catch (e) {
      // Transport error (undici "fetch failed") → retry; surface the cause on the
      // final throw so callers don't see an opaque message.
      lastErr = e.cause ? new Error(`${e.message} (cause: ${e.cause.code || e.cause.message || e.cause})`) : e;
      if (attempt >= retries) throw lastErr;
    }
    await sleep(baseDelayMs * 2 ** attempt); // 400, 800, 1600 ms
  }
  throw lastErr;
}
