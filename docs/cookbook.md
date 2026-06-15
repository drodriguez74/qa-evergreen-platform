# Cookbook

Task-oriented recipes for operating the QA Evergreen Platform. For the rules and architecture, see
[`AGENTS.md`](../AGENTS.md); for the why, [`docs/implementation-plan.md`](implementation-plan.md).

Every recipe assumes the **model gateway is running** unless noted:

```bash
cd toolkit/gateway && npm install && npm start     # http://localhost:4100
```

The active app is selected with `QA_PROFILE` (or `QA_PROFILE_PATH=/abs/path.json`). Recipes use
`<name>` for your profile.

- [0. Set up & verify the environment](#0-set-up--verify-the-environment)
- [1. Onboard a new app (crawl → test)](#1-onboard-a-new-app-crawl--test)
- [2. When the crawl needs help (hand-tune a journey)](#2-when-the-crawl-needs-help-hand-tune-a-journey)
- [3. Add another journey (incl. multi-step)](#3-add-another-journey-incl-multi-step)
- [3b. Authenticate: form vs session (SSO/MFA)](#3b-authenticate-form-vs-session-ssomfa)
- [4. Run a profile's tests](#4-run-a-profiles-tests)
- [5. Generate the evidence metrics](#5-generate-the-evidence-metrics)
- [6. Measure / use the locator healer](#6-measure--use-the-locator-healer)
- [7. Use a different model or provider](#7-use-a-different-model-or-provider)
- [8. Manage secrets (credential provider)](#8-manage-secrets-credential-provider)
- [9. Inspect gateway usage (cost / quota / latency / audit)](#9-inspect-gateway-usage)
- [10. Tune per-repo quota](#10-tune-per-repo-quota)
- [11. Run specs via the standalone runner](#11-run-specs-via-the-standalone-runner)
- [11b. Generate an accessibility-debt report (Tier 4)](#11b-generate-an-accessibility-debt-report-tier-4)
- [12. Troubleshooting](#12-troubleshooting)

---

## 0. Set up & verify the environment

On a fresh clone (do this first — especially on a new machine):

```bash
npm run setup                  # installs platform deps + Playwright Chromium; checks agent-browser
                               #   --demo               also install the FundFlow demo apps
                               #   --with-agent-browser global-install the agent-browser CLI
# put your model key in toolkit/gateway/.env   (e.g. ANTHROPIC_API_KEY=...)
npm run doctor -- --url https://yourapp.example.com
```

`doctor` reports `[OK]/[WARN]/[FAIL]` for Node version, npm, agent-browser, installed deps, Playwright
Chromium, a model key (never printed), whether the gateway is up, and whether your **target app is
reachable** (catches VPN/cert issues before you waste a crawl). It exits non-zero only on a hard
failure (node/npm); warnings are guidance.

## 1. Onboard a new app (crawl → test)

**Goal:** go from a URL to a passing test of record.

```bash
# Crawl the live app, scaffold profiles/<name>.json + a first journey
node toolkit/agents/profile_init.mjs <name> <url> --user <U> --pass <P>

# Discover live → compile → run
QA_PROFILE=<name> node toolkit/agents/journey_discoverer.mjs
QA_PROFILE=<name> node toolkit/agents/test_generator.mjs
cd steel-thread/thread && QA_PROFILE=<name> npx playwright test
```

**Notes**
- `profile_init` performs the login during the crawl and grounds the assertion in the *real*
  post-action a11y diff (the caused state change). Use **synthetic / public demo creds** only.
- Output lands in `steel-thread/thread/out/<name>/<journeyId>/` (gitignored, regenerable).
- No creds or no detectable login form? It still emits a profile with the entry screen and marks
  uncertainty in `_meta`; continue with recipe 2.

## 2. When the crawl needs help (hand-tune a journey)

**Goal:** fix a scaffolded journey whose steps or caused-state-change aren't right.

Edit `profiles/<name>.json` → `journeys[]`. A journey is:

```jsonc
{
  "id": "login-happy-path",
  "entryPath": "/login",
  "steps": [
    {
      "intent": "Sign in",
      "gating": true,
      "actions": [
        { "kind": "fill",  "target": { "role": "textbox", "name": "Username" }, "value": "Admin" },
        { "kind": "fill",  "target": { "role": "textbox", "name": "Password" }, "value": "admin123" },
        { "kind": "click", "target": { "role": "button",  "name": "Login" } }
      ],
      "causedStateChange": [ { "role": "heading", "name": "Dashboard" } ]
    }
  ]
}
```

Then re-run discover → generate → test (recipe 1, steps 2–4). To find the *exact* role + accessible
names, recon with agent-browser:

```bash
bash -lc 'agent-browser open <url> --session recon --allowed-domains <host>; \
          agent-browser snapshot -i --session recon --json; agent-browser close --all'
```

**Note:** `causedStateChange` must be a node that appears **only after** the gating action — assert the
effect, not navigation. Use a role+name actually present in the post-action snapshot (e.g. SauceDemo's
"Products" is `StaticText`, not a `heading` — pick a real interactive/heading node).

## 3. Add another journey (incl. multi-step)

**Goal:** cover a second flow (e.g. navigate to a sub-page after login).

1. Recon the navigation to confirm the link's accessible name + the heading it reveals (recipe 2 recon).
2. Add a new entry to `journeys[]` with a fresh `id`, a login step, then a `gating` navigation step whose
   `causedStateChange` is the revealed node.
3. Run it by id:

```bash
QA_PROFILE=<name> node toolkit/agents/journey_discoverer.mjs <journeyId>
QA_PROFILE=<name> node toolkit/agents/test_generator.mjs <journeyId>
cd steel-thread/thread && QA_PROFILE=<name> npx playwright test
```

**Note:** each journey gets its own `out/<name>/<journeyId>/` with its own `pages/` — regenerating one
never clobbers another's page objects.

## 3b. Authenticate: form vs session (SSO/MFA)

The profile's `auth.mode` decides how journeys get past login:

**`form` (default)** — login is a journey step (user/pass; MFA bypassed). Nothing extra: the journey
fills the fields and clicks submit, and `profile_init` scaffolds this automatically. Use when you can
log in with a plain username/password.

**`session`** — for SSO/MFA (or anything you can't script). Log in **once** in a real browser; the
authenticated state (cookies + storage) is captured and reused by both the test run (Playwright
`storageState`) and discovery (agent-browser `--state`).

```bash
cd steel-thread/thread

# SSO/MFA: opens a headed browser — you log in (incl. 2FA), then press Enter to save
QA_PROFILE=<name> npm run auth:capture -- --manual

# Form app (or CI): headless, replays the login journey's role+name actions
QA_PROFILE=<name> npm run auth:capture
```

Then in `profiles/<name>.json` set `"auth": { "mode": "session" }`, and author session-mode
journeys that **start on a protected page with no login step** (the gating step is an in-app action +
its caused state change). Discover → generate → run as usual — every context starts authenticated.

**Notes**
- The captured state lands in `.auth/<name>.json` (**gitignored** — it holds live session tokens).
- Re-run `auth:capture` when the session expires.
- `--manual` needs a display (your office machine), not a headless server.

## 4. Run a profile's tests

```bash
cd steel-thread/thread
QA_PROFILE=<name> npx playwright test                 # all journeys for the profile
QA_PROFILE=<name> npx playwright test <journeyId>     # one journey
QA_PROFILE=<name> npx playwright test --list          # enumerate without running
QA_PROFILE=<name> npx playwright test --project=<target>   # one target (e.g. react/angular)
```

**Note:** no gateway needed to *run* compiled specs — only to generate them.

## 5. Generate the evidence metrics

From `steel-thread/thread/` (gateway up for the model-backed ones):

```bash
QA_PROFILE=<name> npm run metrics:coverage    # UI/API journey coverage + drift → coverage-manifest.json
QA_PROFILE=<name> npm run metrics:healer      # healer false-positive rate at the 0.9 threshold
QA_PROFILE=<name> npm run metrics:latency     # model-call p50/p95/p99 vs the 30s budget
npm run metrics:ai-draft                      # AI-draft false-positive rate (fundflow trace)
```

Knobs: `STEEL_THREAD_AI_RUNS` (default 5), `STEEL_THREAD_LATENCY_RUNS` (default 30),
`HEALER_CONFIDENCE_THRESHOLD` (default 0.9). Writeup: `steel-thread/thread/metrics/REPORT.md`.

## 6. Measure / use the locator healer

**Goal:** quantify how reliably drifted locators get healed (and tune the confidence gate).

```bash
cd steel-thread/thread
QA_PROFILE=<name> HEALER_CONFIDENCE_THRESHOLD=0.92 npm run metrics:healer
```

This seeds realistic breakages (synonym, truncation, case, role-swap, unhealable decoy) and scores each
heal against the contract (or, for contract-less profiles, the discovered live a11y tree). To call the
healer directly from code:

```js
import { heal } from './toolkit/agents/locator_healer.mjs';
const fix = await heal({ broken: { role: 'button', name: 'Submit transfer' },
                         candidates: [{ role: 'button', name: 'Confirm transfer' }],
                         gatewayUrl: 'http://localhost:4100', repo: '<name>' });
// → { role, name, confidence, source }
```

**Note:** auto-heal-on-failure in CI is intentionally **not** wired — autonomy stays off until the
false-positive rate is trusted (plan §21.4). The healer proposes; a human/threshold decides.

## 7. Use a different model or provider

The default is `claude-sonnet-4-6`. Switch with one env var on the **gateway** — no agent changes:

```bash
# Different Claude models per tier
QA_MODEL_REASONING=anthropic:claude-sonnet-4-6 QA_MODEL_FAST=anthropic:claude-haiku-4-5 npm start

# Azure OpenAI (adapter is wired; needs an endpoint + key)
QA_MODEL_REASONING=azure:<deployment> AZURE_OPENAI_ENDPOINT=https://x.openai.azure.com \
  AZURE_OPENAI_API_KEY=... npm start
```

To add a brand-new provider: create `toolkit/gateway/adapters/<name>.js` exporting `ready()` and
`complete(neutralRequest) → {output, usage}`, register it in `adapters/index.js`, then set
`QA_MODEL_REASONING=<name>:<model>`.

## 8. Manage secrets (credential provider)

Keys live **only** in the gateway process; the *source* is pluggable (`QA_CRED_PROVIDER`):

```bash
QA_CRED_PROVIDER=env            npm start   # default: process.env → gateway .env → steel-thread/.env
QA_CRED_PROVIDER=azure-keyvault AZURE_KEY_VAULT_URL=https://v.vault.azure.net \
  AZURE_KEY_VAULT_TOKEN=... npm start       # Key Vault (token-acquisition step is the documented follow-up)
```

Confirm which is active: `curl -s localhost:4100/healthz` → `credentialProvider`. Never put keys in
profiles, specs, logs, or commits (`.env` is gitignored).

## 9. Inspect gateway usage

```bash
curl -s http://localhost:4100/healthz   # tiers, provider readiness, credentialProvider
curl -s http://localhost:4100/v1/usage  # per-repo cost (estimate), quota, latency p50/p95/p99, audit path
```

The audit log (`toolkit/gateway/audit/gateway-audit.jsonl`, gitignored) records one metadata line per
call — `repo, tier, provider, model, payload_types, usage, cost_usd, latency_ms` — never prompt content.

## 10. Tune per-repo quota

Gateway env (defaults in `toolkit/gateway/config.js`):

```bash
QA_REPO_MAX_REQUESTS=200 QA_REPO_TOKEN_BUDGET=2000000 QA_QUOTA_WINDOW_MS=3600000 npm start
```

Over budget → the gateway returns `429 quota_exceeded` with `retry_after_s`. Resilience knobs:
`QA_GATEWAY_TIMEOUT_MS` (default 60000), `QA_GATEWAY_RETRIES` (default 1).

## 11. Run specs via the standalone runner

`runner/` is a self-contained Playwright package so specs can run from **outside** `steel-thread/thread`:

```bash
cd runner && npm install && npx playwright install chromium
npx playwright test --config=playwright.example.config.ts    # runs runner/example/* (proof)
```

See `runner/README.md`. Migrating the main pipeline onto it (repointing `workDir` to repo-root
`runs/<profile>/`) is a documented follow-up, not yet done.

## 11b. Generate an accessibility-debt report (Tier 4)

The same missing-ARIA gaps the locator strategy works *around* are real accessibility defects in the
target app. The Tier-4 remediator turns them into a deliverable: it scans the profile's existing
trace(s) **on disk** (no live browsing) and emits an a11y-debt report plus a draft remediation.

```bash
QA_PROFILE=<name> node toolkit/agents/a11y_remediator.mjs
# → <workDir>/a11y-debt-report.json
# → <workDir>/a11y-debt-report.md   (findings + per-element patch suggestion + draft PR description)
```

What it flags as **a11y debt**:

- **Tier-1 locator debt** — actions the discoverer recorded with `locator.debt === true` or
  `strategy:'unresolved'` (it had to degrade below role+name, or couldn't resolve the element at all).
- **Interactive-but-unlabeled snapshot nodes** — clickable / `[onclick]` / `cursor:pointer` nodes
  that are icon-only glyphs (e.g. `☰`), have no accessible name, or use a passive role (a `<div>`/`<p>`
  acting as a button). Clickable structural roles (rows, list items) with real names are left alone.

Each finding gets a suggested `aria-label`, phrased by the **gateway reasoning tier** when `:4100` is
up (e.g. `☰` → "Open menu"), and a **deterministic fallback** otherwise (fail open). The report is
read-only — it never opens a PR. Resolving each element signature to its frontend source file and
opening a real draft PR against the app repo is the documented follow-up.

## 12. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `compile: ... deterministic fallback (gateway unavailable)` | Gateway not running on `:4100`. Start it; or accept the deterministic artifacts. |
| `test_generator` exits with "start the model gateway" | Generation needs a model; start the gateway (recipe 7 for a non-Claude provider). |
| `502 provider_unavailable` from the gateway | The active tier's provider isn't ready (no key / wrong provider). Check `/healthz`. |
| `429 quota_exceeded` | Per-repo budget hit; raise it (recipe 10) or wait `retry_after_s`. |
| Discovery: `... action fill ... failed: no ref` | The role+name in the journey step doesn't match the live a11y tree. Recon and correct the name (recipe 2). |
| `page.goto: Test timeout` on a live site | Slow remote load. The runner config already sets `navigationTimeout` + a retry; add explicit waits — never weaken the caused-state-change assertion. |
| `Requiring @playwright/test second time` (dual-package) | A spec under `steel-thread/thread/out/...` plus the runner both pull a runtime. Run profile specs from `steel-thread/thread`; the repo-root runner migration removes this. |
| Healer false positives on a real app | Duplicate accessible names across roles. Raise `HEALER_CONFIDENCE_THRESHOLD` or add role corroboration. |
