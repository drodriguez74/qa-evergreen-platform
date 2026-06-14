# AGENTS.md

Guidance for any coding agent (Claude Code or otherwise) working in **or with** the QA Evergreen
Platform — an AI-accelerated, discovery-driven test automation platform. Read this before editing or
running anything. New to the repo? Start with [`README.md`](README.md); the strategy is in
[`docs/implementation-plan.md`](docs/implementation-plan.md) (read §21 first).

There are two audiences here, both served below: people **using** the platform to test their own app,
and people **working on** the platform itself.

---

## Golden rules (non-negotiable)

1. **All model calls go through the gateway.** Never import a vendor SDK (`@anthropic-ai/sdk`,
   `openai`, …) in an agent. Call `toolkit/gateway` over HTTP (`http://localhost:4100`, tiers
   `reasoning`/`fast`). Start the gateway before any model-mode work. This is what keeps the platform
   provider-agnostic and the credential isolated.
2. **Locate by ARIA role + accessible name only.** `getByRole` / `getByLabel` with the exact accessible
   name. Never CSS selectors, `data-testid`, XPath, or `@ref` in committed tests. This portability is
   the platform's core bet.
3. **Everything is profile-driven.** To support a new app, add a `profiles/<app>.json` — do **not**
   hardcode app specifics (URLs, journeys, accessible names) into agents, configs, or scripts. Load
   config via `toolkit/profile.mjs` (`QA_PROFILE` / `QA_PROFILE_PATH`).
4. **Honor the assertion bar.** Every generated UI test must assert a state change the action *caused*
   (a node present *after* the action that was absent before — e.g. a heading that only appears
   post-login), not merely that a route/URL changed. Navigation-only assertions are coverage theater.
5. **Secrets live only in the gateway's `.env`** (gitignored). Never put API keys in profiles, specs,
   logs, or commits. App login creds in profiles must be **synthetic/public demo** creds only.
6. **Generated output is regenerable and gitignored.** `steel-thread/thread/out/<profile>/` and
   `runs/` (traces, generated specs, eval JSON) regenerate from the flow below. Don't hand-edit them;
   fix the source (profile/agent) and re-run. (FundFlow's `steel-thread/thread/generated/` is the one
   tracked reference test-of-record.)

---

## Architecture

```
profiles/<app>.json ── one profile per target app (URL, journeys, gateway). Parent defaults + overrides.
        │
toolkit/agents/
  profile_init.mjs       crawl a live app → scaffold a profile + first journey  (install-and-crawl)
  journey_discoverer.mjs drive agent-browser by role+name → trace + caused-state-change
  test_generator.mjs     trace → Playwright spec + Page Objects + feature (facts from the trace)
  locator_healer.mjs     drifted locator + candidate nodes → proposed fix + confidence
        │  (every model call ↓)
toolkit/gateway/         provider-agnostic broker: pluggable credential source, two tiers,
                         per-repo quota + cost + payload-type audit + latency
        │
runner/  ·  steel-thread/thread/   Playwright runs the compiled specs against the profile's targets
```

`toolkit/profile.mjs` resolves the active profile (paths, `targets`, `workDir`, `gateway`). One
profile == one gateway `repo` id, so cost/quota/audit/latency are attributed per app.

---

## Using the platform on your app

Onboard a new application as a profile, then discover → generate → run.

```bash
# 0. Start the gateway (holds the provider key; default model claude-sonnet-4-6)
cd toolkit/gateway && npm install && npm start          # http://localhost:4100

# 1. Crawl the live app and scaffold profiles/<name>.json (+ a first journey)
node toolkit/agents/profile_init.mjs <name> <url> [--user U --pass P]

# 2. Discover the journey live, compile it, run it
QA_PROFILE=<name> node toolkit/agents/journey_discoverer.mjs [journeyId]
QA_PROFILE=<name> node toolkit/agents/test_generator.mjs   [journeyId]
cd steel-thread/thread && QA_PROFILE=<name> npx playwright test
```

- A journey is declared in the profile's `journeys[]` as `{ entryPath, steps[] }`, where each step's
  actions are `{ kind, target:{role,name}, value }` and the gating step carries a `causedStateChange`
  node. `profile_init` scaffolds this for you by crawling; you can hand-edit/extend it.
- Each journey gets its own isolated output dir (`<workDir>/<journeyId>/` with its own `pages/`), so
  regenerating one journey never clobbers another's page objects.
- Profile schema and adoption modes: [`profiles/README.md`](profiles/README.md).

## Working on the platform

```bash
# Steel thread (FundFlow: React+Angular behind one a11y contract) — the reference rig
cd steel-thread/api      && npm install && npm start     # mock API :4000
cd steel-thread/apps/react   && npm install && npm run dev   # :5173
cd steel-thread/apps/angular && npm install && npm start      # :4200
cd steel-thread/thread   && npm install && npx playwright install chromium

# From steel-thread/thread:
QA_PROFILE=fundflow npx playwright test        # same compiled spec on both frameworks
npm run metrics:coverage                       # UI/API coverage + drift  → coverage-manifest.json
npm run metrics:ai-draft                       # AI-draft false-positive rate (gateway up)
npm run metrics:healer                         # healer false-positive rate (gateway up)
npm run metrics:latency                        # model-call p50/p95/p99 (gateway up)
```

- The POC evidence (the three §21.5 numbers) lives in `steel-thread/thread/metrics/REPORT.md`. Metrics
  are reproducible and non-destructive (the AI-draft harness backs up/restores committed artifacts).
- The gateway's contract, tiers, and credential seam: [`toolkit/gateway/README.md`](toolkit/gateway/README.md).
- `runner/` is a standalone Playwright package that lets generated specs run from outside
  `steel-thread/thread` (the path to publishing); see `runner/README.md`.

---

## Conventions & gotchas

- **Gateway down → deterministic fallback.** `test_generator`/`trace_compiler` emit correct hand-written
  artifacts and `locator_healer` falls back to string similarity when `:4100` is unreachable. The
  console/JSON prints which mode ran. Don't "fix" a fallback by hardcoding a key in an agent.
- **agent-browser (v0.27) selectors:** fills resolve by `@ref` (snapshot → find role+name → `fill @ref`);
  buttons/links resolve via `find role <r> click --name <n>`. The discoverer handles this for declared
  steps. Always pass `--allowed-domains <host>` and a unique `--session`; `close --all` when done.
- **Live external sites are flaky.** Use web-first assertions with generous timeouts; the runner config
  sets `navigationTimeout` + a retry. If a live run flakes, add waits — never weaken the
  caused-state-change assertion to make it pass.
- **Provider default is Claude Sonnet.** Switching providers is a one-env-var flip
  (`QA_MODEL_REASONING`); the Azure adapter is interface-complete pending a credential. Don't build
  provider-specific logic into agents.
- **No-contract apps:** real apps have no authoritative a11y contract — the discovered live a11y tree
  *is* the surface. `coverage`/`healer_eval` source candidates from the trace when `profile.contract`
  is null.

## Don't

- Don't import a vendor LLM SDK in an agent, or read provider keys from `process.env` outside the
  gateway's credential provider.
- Don't hardcode an app's URLs/journeys/accessible-names anywhere but its profile.
- Don't commit `.env`, `node_modules`, or `out/`/`runs/` output.
- Don't use CSS/testid/XPath locators in committed tests.
- Don't assert navigation alone; assert the caused state change.
