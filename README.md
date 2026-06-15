# QA Evergreen Platform

An AI-accelerated, **discovery-driven** QA automation platform. Point it at an application; it
crawls the live UI, derives a user journey, compiles that journey into a deterministic Playwright
test of record, runs it, and self-heals drifted locators — with every model call flowing through a
single, provider-agnostic gateway that owns credentials, cost, quota, and audit.

The core bet: a test located by **ARIA role + accessible name** (not CSS/testids) is portable across
frameworks and resilient to refactors. Proven on a React/Angular pair behind one a11y contract, and
on live external apps (OrangeHRM, SauceDemo) with no contract at all — the live accessibility tree
*is* the surface.

> Strategy & rationale: [`docs/implementation-plan.md`](docs/implementation-plan.md) (read §21 first —
> it states what's built vs. target-state). Status: a working proof-of-concept + the platform spine,
> not yet the full company rollout described in §1–20.
>
> **Using a coding agent (Claude Code, etc.) on this repo?** Point it at [`AGENTS.md`](AGENTS.md) — the
> golden rules, onboarding flow, and conventions it must follow.

## How it fits together

```
profiles/<app>.json ─ one profile per target app (URL, journeys, gateway). Parent + overrides.
        │
toolkit/agents/
  profile_init      crawl a live app → scaffold a profile + journey (install-and-crawl)
  journey_discoverer drive agent-browser by role+name → trace + caused-state-change
  test_generator    trace → Playwright spec + Page Objects + feature (facts from the trace)
  locator_healer    drifted locator → proposed fix + confidence (self-healing)
        │  (every model call goes through ↓)
toolkit/gateway/    provider-agnostic broker: credential isolation (pluggable source),
                    two tiers (reasoning/fast), per-repo quota + cost + payload audit + latency
        │
runner/  +  steel-thread/thread/   run the compiled specs (Playwright) against the profile's targets
```

## Quickstart — onboard an app

```bash
# 0. Install deps + browser, then verify the environment
npm run setup                          # installs platform deps + Playwright Chromium
npm run doctor -- --url https://yourapp.example.com   # node/agent-browser/key/app reachability

# 1. Start the model gateway (holds the provider key; default model claude-sonnet-4-6)
cd toolkit/gateway && npm install && npm start          # http://localhost:4100

# 2. Crawl the target and scaffold a profile + first journey
node toolkit/agents/profile_init.mjs myapp https://myapp.example.com --user U --pass P

# 3. Discover → generate → run (profile-driven)
QA_PROFILE=myapp node toolkit/agents/journey_discoverer.mjs
QA_PROFILE=myapp node toolkit/agents/test_generator.mjs
cd steel-thread/thread && QA_PROFILE=myapp npx playwright test
```

For SSO/MFA apps, use session-mode auth instead of `--user/--pass` — see the
[cookbook](docs/cookbook.md) → "Authenticate".

See [`profiles/README.md`](profiles/README.md) for the profile schema and adoption modes, and
[`toolkit/gateway/README.md`](toolkit/gateway/README.md) for the gateway + credential seam.

## What's proven (POC evidence)

Measured through the gateway, reproducible via `steel-thread/thread/metrics/` (see its `REPORT.md`):

- **Framework-agnostic test of record** — one compiled spec passes on both React and Angular builds.
- **AI-draft false-positive rate** — 0–20% over repeated compiles (one journey).
- **Healer false-positive rate** — 0–1.5% at the 0.9 confidence threshold; 100% true-negative on decoys.
- **Model-call latency** — p99 ≈ 2s on the fast tier (~15× under the 30s blocking-path budget).
- **Live external apps** — OrangeHRM (multi-step) and SauceDemo (auto-scaffolded) run green against the real sites.

## Layout

| Path | What |
|---|---|
| `toolkit/gateway/` | the model gateway (the lynchpin; start it first) |
| `toolkit/agents/` | profile_init, journey_discoverer, test_generator, locator_healer |
| `toolkit/profile.mjs` | the per-target profile loader |
| `profiles/` | one JSON per target app (`fundflow` reference + live examples) |
| `steel-thread/` | the React/Angular demo apps, mock API, and the test harness + metrics |
| `runner/` | a standalone Playwright runner package (decouples specs from the steel thread) |
| `docs/` | the implementation plan, [roadmap to "complete"](docs/roadmap-to-ecosystem.md), the [discovery-vs-breadcrumb decision](docs/discovery-vs-breadcrumb.md), model-gateway scope, the [cookbook](docs/cookbook.md), and the [handoff/audit](docs/HANDOFF.md) guide |
| `ci/` | `qa-ecosystem.gitlab-ci.yml` — shared CI template skeleton (Layer 4); `scripts/coverage_gate.mjs` is the merge gate |

## Notes

- **Secrets:** provider keys live only in the gateway process (`.env`, gitignored), never in profiles
  or specs. The credential *source* is pluggable (`env` default; Azure Key Vault interface-complete).
- **Provider:** Claude Sonnet is the default; the gateway makes the provider a one-env-var flip
  (the Azure adapter is interface-complete, pending a credential).
- Generated tests/traces under `steel-thread/thread/out/` and `runs/` are regenerable and gitignored.
