# QA Model Gateway (POC)

The single chokepoint every agent calls **instead of** a vendor SDK. Plan §21.4 names building
this as the first `[POC]` lynchpin — it is what makes credential isolation, cost caps, and
rate-limiting real rather than asserted. Scope and rationale: [`../../docs/model-gateway-scope.md`](../../docs/model-gateway-scope.md).

This is the **POC form**: a local HTTP service. The agent-facing contract is identical to the
eventual `platform/qa-toolkit` service, so the host can change (lib → sidecar → service) without
touching agent code.

## What it does

| Concern | How |
|---|---|
| Provider-agnostic facade (R1) | Callers send a neutral request; the gateway maps a *tier* to a provider+model |
| Two tiers (R2) | `QA_MODEL_REASONING` / `QA_MODEL_FAST`, form `provider:model`, overridable per env |
| Credential isolation (R3) | Provider key lives only in this process; never returned to callers. Its *source* is pluggable via `credentials.js` (`QA_CRED_PROVIDER`: `env` default, `azure-keyvault` interface-complete) |
| Per-repo quota (R4) | In-memory rolling window; `429` when over budget |
| Cost attribution (R5) | Estimated $ per repo from a price table; `GET /v1/usage` |
| Payload-type audit (R6) | Append-only JSONL of metadata (types, not content) in `audit/` |
| Strict structured output (R7) | A neutral `tool` maps to Anthropic strict tool use / OpenAI json_schema |
| Resilience (R8) | Timeout + 1 retry; `502` on failure so callers fall back deterministically |

## Run

```bash
npm install
npm start          # listens on http://localhost:4100
```

The credential is read from `process.env`, then `toolkit/gateway/.env`, then `steel-thread/.env`
(where the POC's `ANTHROPIC_API_KEY` already lives) — so it works out of the box.

## API

```
GET  /healthz       → { ok, tiers, providers:{anthropic, azure}, credentialProvider, vision }
GET  /v1/usage      → { cost (per repo, estimated), quota, auditLog path, credentialProvider }
POST /v1/messages   → see docs/model-gateway-scope.md §4 for the request/response contract
```

### Multimodal (vision) content

`messages[].content` accepts **either** a plain string (the historical shape — unchanged)
**or** an array of content blocks, so a discovery step can ask a vision model to identify
unlabeled UI elements:

```jsonc
"content": [
  { "type": "text",  "text": "What color is this image? One word." },
  { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "<base64>" } }
]
```

Bad shapes return `400` with a clear message. The anthropic adapter passes content-block
arrays straight to the Messages API (Sonnet 4.6 is multimodal); the azure adapter maps them
to OpenAI's `image_url` parts for contract parity.

## Credential providers (the PILOT secret-handling seam)

Adapters never read `process.env` for keys directly — they call `credentials.get('ANTHROPIC_API_KEY')`,
so the *source* of secrets is swappable without touching adapter code. Select one with `QA_CRED_PROVIDER`:

| Provider | State | Notes |
|---|---|---|
| `env` (default) | built | Owns the `.env` cascade (process.env → gateway `.env` → `steel-thread/.env`). Same behavior as before. |
| `azure-keyvault` | interface-complete | Real Key Vault REST shaping; reports not-ready unless `AZURE_KEY_VAULT_URL` + `AZURE_KEY_VAULT_TOKEN` are set. The Azure AD token-acquisition step is the documented follow-up (no new npm deps). |

```bash
QA_CRED_PROVIDER=env            npm start   # default — env provider
QA_CRED_PROVIDER=azure-keyvault npm start   # seam flips; needs AZURE_KEY_VAULT_URL + token to be ready
```

This is a swappable *seam*, not a commitment to Azure — the default stays `env`.

## The provider bake-off (§21.2)

Flip the reasoning tier and re-run the evidence harness — no code change:

```bash
QA_MODEL_REASONING=anthropic:claude-sonnet-4-6 npm start   # then: (cd ../../steel-thread/thread && npm run metrics:ai-draft)
QA_MODEL_REASONING=azure:gpt-5.2               npm start   # needs AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_API_KEY
```

The Anthropic adapter is built; the Azure adapter is interface-complete and runs the moment an
in-tenant credential is provided.
