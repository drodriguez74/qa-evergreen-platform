# Model Gateway — POC Scope

**Status:** proposed scope · **Milestone:** `[POC]` (plan §21.4, first lynchpin) · **Date:** 2026-06-14

> Plan §21.4 names "build the model gateway as a real service" as the **first `[POC]` item** — the
> lynchpin of secret-isolation, cost caps, and rate-limiting. §21.5 also says the steel thread
> should run "behind the gateway from day one." Today it does not: `steel-thread/thread/trace_compiler.mjs`
> calls `@anthropic-ai/sdk` directly. This document scopes the **minimum real gateway** that closes
> that gap and unblocks the §21.2 provider bake-off — and explicitly defers everything that only
> bites at PILOT/SCALE.

## 1. Why this is the next step (not Phase 1)

The evidence pass (`steel-thread/thread/metrics/`) measured metric #1 (AI-draft false-positive
rate = 0% on one journey, Anthropic only). The two open items that gate the go/no-go both run
**through** the gateway:

- **The provider bake-off (§21.2)** — metric #1 across Azure GPT-5.2 *and* Claude Sonnet on the
  same traces. Impossible while the compiler is hard-wired to one vendor SDK.
- **Credential isolation / cost attribution / audit (Rule 6, §17)** — the controls AppSec flagged.
  None can exist until there is a single chokepoint for model calls.

So the gateway is the smallest build that turns "0% on Anthropic" into "0% vs X% across both
providers, with per-repo cost and an audit trail" — i.e. the actual decision input.

## 2. Requirements (traced to the plan)

| # | Requirement | Source |
|---|---|---|
| R1 | Provider-agnostic facade — callers send a neutral request; never import a vendor SDK | §17 L1037, §21.2 L1241 |
| R2 | Two tiers `reasoning` / `fast`, each bound to a provider+model, per-repo overridable, tiers may route to different providers | §17 L1049, §21.2 L1257 |
| R3 | Credential isolation — provider key lives only in the gateway; never returned to or held by callers | Rule 6 L197, L264 |
| R4 | Per-repo quota / rate budget; one repo can't starve others | Rule 6 L197, §15 L981 |
| R5 | Per-repo cost attribution (for the KPI dashboard) | Rule 6 L197 |
| R6 | Payload-type audit log (source / DOM / screenshot / trace) per repo | §17 L1055, §21.4 L1274 |
| R7 | Strict structured output passthrough (JSON-schema / strict tool use) | §21.2 L1249/L1255 |
| R8 | Outage behavior — timeout + retry, caller degrades gracefully (deterministic fallback) | §15 L981 |

## 3. Recommended form factor: a local HTTP gateway

**A small Node/Express service on localhost**, not an in-process library.

- *Why a service, not a library:* R3 (credential isolation) and R6 (audit chokepoint) are only
  *real* if the key lives in a different process than the agent and every call crosses one seam.
  A library makes them code conventions, not controls.
- *Why local/Express:* mirrors the existing `steel-thread/api` mock-API pattern (zero new infra),
  runs on a dev machine per §21.5, and the **agent-facing contract is identical** to the eventual
  `platform/qa-toolkit` service — so the lib→sidecar→service deployment can change later **without
  touching agent code** (R1). The contract is the durable artifact; the host is not.

**Home:** `toolkit/gateway/` — the `toolkit/` skeleton already exists (`agents/ parsers/ templates/`)
and maps to the plan's `platform/qa-toolkit`.

## 4. The contract (the durable seam)

```
POST /v1/messages
{
  "repo": "fundflow",                 // R4/R5/R6 attribution key
  "tier": "reasoning" | "fast",       // R2 — gateway maps to provider+model
  "system": "…",                      // optional
  "messages": [{ "role": "user", "content": "…" }],
  "tool":        { "name", "description", "input_schema" },   // R7 structured output
  "tool_choice": { "type": "tool", "name": "…" },
  "max_tokens": 8000,
  "payload_types": ["trace", "contract"]   // R6 — declared by caller, logged (types, not content)
}
→ 200 { "output": <tool input object>, "provider", "model",
        "usage": { "input_tokens", "output_tokens" }, "cost_usd", "request_id" }
→ 429 { "error": "quota_exceeded", "repo", "retry_after_s" }      // R4
→ 502 { "error": "provider_unavailable", "request_id" }           // R8 → caller falls back
```

Tier binding (gateway-side config / env), provider:model form so the bake-off is a one-line flip:

```
QA_MODEL_REASONING = anthropic:claude-sonnet-4-6      # or  azure:gpt-5.2
QA_MODEL_FAST      = anthropic:claude-haiku-4-5
```

## 5. Internals (POC-level: real but minimal)

- **Provider adapters** behind one interface `complete(neutralRequest) → neutralResponse`:
  - `anthropic` — **built** (lift the working `messages.create` + strict `emit_artifacts` tool-use
    from `trace_compiler.mjs`).
  - `azure-openai` — **interface-complete**, maps tool → JSON-schema structured output. Wired but
    pending an Azure GPT-5.2 credential (see §7 assumption). The bake-off runs the moment a cred lands.
- **Credential handling (R3):** provider keys read once from the gateway's own env/Key-Vault shim;
  never logged, never in responses.
- **Quota (R4):** in-memory per-repo token+request budget per rolling window → `429`. (Fair-share
  across many repos is SCALE.)
- **Cost (R5):** `usage × price-table[provider:model]` accumulated per repo; `GET /v1/usage`.
- **Audit (R6):** append-only JSONL `{ ts, repo, tier, provider, model, payload_types, usage, cost,
  request_id }` — metadata only, never prompt content. (Tamper-evident/signed is PILOT.)
- **Resilience (R8):** per-call timeout + 1 retry; on failure return `502`. The steel-thread
  compiler already has a deterministic fallback — gateway-down simply triggers it, exactly mirroring
  the plan's "fail open to a deterministic test of record."

## 6. Work breakdown

| # | Item | Notes |
|---|---|---|
| W1 | `toolkit/gateway/` Express service + `/v1/messages`, `/v1/usage`, `/healthz` | reuse `steel-thread/api` patterns |
| W2 | Provider-adapter interface + `anthropic` adapter | port from `trace_compiler.mjs` |
| W3 | Middleware: tier routing, per-repo quota, cost table, audit JSONL | R2/R4/R5/R6 |
| W4 | Refactor `trace_compiler.mjs`: `generateWithAnthropic()` → `callGateway()`; keep deterministic fallback as the 502 path | makes the compiler provider-agnostic |
| W5 | `azure-openai` adapter (structured-output mapping), behind config; bake-off runner: `metrics:ai-draft` × {anthropic, azure} | delivers §21.2 |

**Status (2026-06-14): W1–W4 built and verified** — the steel thread runs "behind the gateway from
day one," all eight requirements exercised live. W5's `azure` adapter is interface-complete; the
bake-off run is deferred (Sonnet is the default, §8) until/if a credential is provided.

## 7. Explicitly out of scope (deferred, tagged)

| Deferred item | Milestone | Why not now |
|---|---|---|
| Azure AD / managed identity, Key Vault, AWS IAM/SigV4 real auth | PILOT | POC uses env-provided keys in the gateway process; the *isolation seam* is what matters now |
| Deploy as a networked `platform/qa-toolkit` service, mTLS | PILOT | localhost is faithful to the contract; no CI exists yet |
| Tamper-evident / signed audit log, SOX/PCI control mapping | PILOT | §21.4 PILOT row; POC proves the capture point |
| Fair-share rate distribution, prompt caching, batch API | SCALE | single repo in the POC; nothing to be fair between |
| Per-repo spend cap + alerting + kill switch | SCALE | §21.4 `[SCALE]` row verbatim |

## 8. Assumptions & the one open question

- **Anthropic credential** is available (it is — `steel-thread/.env`), so W1–W4 are unblocked today.
- **Decision (2026-06-14):** **Claude Sonnet (`claude-sonnet-4-6`) is the default model for now.**
  The Azure GPT-5.2 bake-off is **not a blocker** — provider choice is deliberately deferred to a
  future config decision the owner will make. The gateway keeps this a one-env-var flip
  (`QA_MODEL_REASONING`), so deferring costs nothing: W1–W4 (built) deliver the gateway, isolation,
  cost, and audit independently; W5's `azure` adapter is interface-complete and runs the moment a
  credential is provided.

## 9. Definition of done

1. `trace_compiler.mjs` makes **no** direct vendor-SDK call — it calls the gateway; with the gateway
   down it deterministically falls back (R1/R3/R8).
2. `GET /v1/usage` shows non-zero per-repo cost after a compile (R5); the audit JSONL has one
   metadata line per call (R6); exceeding the repo budget returns `429` (R4).
3. `npm run metrics:ai-draft` produces the same evidence as today, now **through** the gateway — and,
   if an Azure cred exists, a second column for GPT-5.2 (the §21.2 bake-off).
