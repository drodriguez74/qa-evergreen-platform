// middleware/quota.js — per-repo quota (R4). In-memory rolling window: a repo
// gets a request-count and token budget per window; exceeding either yields 429.
// POC-level — proves the chokepoint. Fair-share across many repos is SCALE.

import { QUOTA } from '../config.js';

const buckets = new Map(); // repo -> { windowStart, requests, tokens }

function bucket(repo) {
  const now = Date.now();
  let b = buckets.get(repo);
  if (!b || now - b.windowStart >= QUOTA.windowMs) {
    b = { windowStart: now, requests: 0, tokens: 0 };
    buckets.set(repo, b);
  }
  return b;
}

/** Pre-call gate. Returns null if allowed, or a 429 payload if over budget. */
export function check(repo) {
  const b = bucket(repo);
  if (b.requests >= QUOTA.maxRequests) {
    return { error: 'quota_exceeded', scope: 'requests', repo, retry_after_s: retryAfter(b) };
  }
  if (b.tokens >= QUOTA.maxTokens) {
    return { error: 'quota_exceeded', scope: 'tokens', repo, retry_after_s: retryAfter(b) };
  }
  return null;
}

/** Count a request at dispatch time (so concurrent calls can't all slip the gate). */
export function reserve(repo) {
  bucket(repo).requests += 1;
}

/** Record actual token usage after the call completes. */
export function record(repo, totalTokens) {
  bucket(repo).tokens += totalTokens;
}

function retryAfter(b) {
  return Math.max(0, Math.ceil((b.windowStart + QUOTA.windowMs - Date.now()) / 1000));
}

export function snapshot() {
  const out = {};
  for (const [repo, b] of buckets) {
    out[repo] = { requests: b.requests, tokens: b.tokens, windowStartedAt: new Date(b.windowStart).toISOString() };
  }
  return out;
}
