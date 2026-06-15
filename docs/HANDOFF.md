# Handoff & Audit

Two-way continuity between this dev environment and the office (real-app) environment.
**Out** = pick up cleanly in the office. **Back** = bring office changes + real-use-case learnings
home for review. Last sync: commit on `main` (`git log -1` for the exact ref).

---

## Current state (what's built & verified)

Working platform, all on GitHub `main`:
- **Gateway** (`toolkit/gateway/`) — provider-agnostic broker: credential isolation (pluggable
  source: `env` / `azure-keyvault`), two tiers, per-repo quota + cost + audit + latency, **multimodal**.
- **Agents** (`toolkit/agents/`) — `profile_init` (crawl→scaffold), `journey_discoverer`,
  `test_generator`, `locator_healer`, `a11y_remediator`.
- **Locator fallback ladder (Tiers 1–4)** — role+name → name → text → placeholder → testid →
  VLM-identified → unresolved, recorded per-action + debt-flagged; deterministic (never coordinates).
- **Profiles** + `profile.mjs`, **runner/**, **setup/doctor**, **dual-mode auth** (form + session SSO/MFA),
  **Tier-2 Vite plugin** (`toolkit/build-plugins/`).
- Evidence (POC metrics) in `steel-thread/thread/metrics/REPORT.md`.

**Verified:** steel-thread (12) + live OrangeHRM (2) + SauceDemo (1) green; role+name unchanged under
the ladder; zero forbidden locators. **Not yet exercised on a real app** — that's the office run.

## Decisions carried over (not all in code)

- **Provider:** Claude Sonnet is the *default*, but the gateway is provider-agnostic (one-env-var flip;
  Azure adapter interface-complete). Office will configure the office's own model key.
- **Language:** built in **Node**; Python is *preferred long-term* but deferred — don't churn; port
  later as one deliberate effort (the HTTP gateway makes agents language-agnostic).
- **Autonomy stays off:** healer/VLM/a11y propose; a human decides. No auto-merge, no auto-PR yet.
- **Determinism:** the test of record never uses coordinates/CSS-nth; lower-tier locators are flagged
  as debt, not hidden.

---

## OUT — continue in the office

```bash
git clone https://github.com/drodriguez74/qa-evergreen-platform.git
cd qa-evergreen-platform && npm run setup
# put the office model key in toolkit/gateway/.env  (ANTHROPIC_API_KEY=... or an Azure provider)
npm run doctor -- --url <the real QA app>          # verifies env + app reachability
cd toolkit/gateway && npm start                     # gateway on :4100
```

Then onboard the real app (cookbook recipe 1 / 3b):
- **user/pass (MFA bypassed):** `node toolkit/agents/profile_init.mjs <app> <url> --user U --pass P`
- **SSO/MFA:** `cd steel-thread/thread && QA_PROFILE=<app> npm run auth:capture -- --manual`, set
  `"auth":{"mode":"session"}` in the profile, author an in-app journey.
- → `journey_discoverer` → `test_generator` → `npx playwright test`; `a11y_remediator` for debt.

Note: a fresh Claude Code install in the office has **no memory of this session** — `AGENTS.md`, the
cookbook, `docs/`, and this file are the continuity. Point the office agent at `AGENTS.md`.

---

## BACK — audit office changes home

Goal: review what the office changed and *why* (real use cases), so we fold the learnings in here.

### Keep it auditable: preserve git history
In the office, **clone the GitHub repo and add the GitLab remote** (don't fresh-`init` from copied
files — that breaks the shared base and makes the audit a manual file diff):
```bash
git remote add gitlab <company-gitlab-url>
git push -u gitlab main
# work on a branch so the audit is a clean diff:
git checkout -b office/<yyyy-mm-dd>
```

### Bring the diff back (pick what the office network allows)
- **If the office laptop can reach GitHub:** push the branch — `git push origin office/<date>` — then
  here: `git fetch origin && git log --oneline origin/main..origin/office/<date>` and review the diff.
- **If GitHub is blocked at the office:** carry a portable artifact:
  `git bundle create qa-evergreen-office-<date>.bundle origin/main..HEAD`  (or `git format-patch
  origin/main`). Bring the file back; here: `git fetch qa-evergreen-office-<date>.bundle '*:office/*'`
  or `git am *.patch` onto a review branch.

### Also bring the DATA (real-use-case evidence, not just code)
These are gitignored locally but are the richest signal — copy them back manually:
- `steel-thread/thread/out/<app>/` traces (each action's `locator.strategy` shows how often the app
  needed role+name vs text vs VLM vs **unresolved** — a direct read on the app's a11y quality and
  where the ladder earned its keep).
- `<workDir>/a11y-debt-report.{json,md}` (what was unlabeled + suggested fixes).
- The gateway audit log / `/v1/usage` (cost, latency on the real app).

### Fill in the session audit (template)
Copy this into the PR/branch description or a note you carry back:

```
## Office session audit — <date>, app: <name>
- Auth: form / session(SSO/MFA)?  what worked, what didn't
- A11y quality: tier hit-rate (role+name __% / text __% / placeholder __% / VLM __% / unresolved __%)
- Journeys onboarded: <list>  — auto-scaffolded vs hand-tuned?
- What broke / edits made (and WHY) — files + reason
- New real use cases the platform didn't handle: <list>
- Cost/latency on the real app: <from /v1/usage>
- Follow-ups for the dev env (here): <list>
```

When you're back, hand me the branch/bundle + this audit and say "catch up" — I'll review the diff,
reconcile it with the dev tree, and turn the learnings into the next backlog.

---

## Backlog (non-blocking)

- Tier-4: resolve element signatures to source and open a **real** aria-label PR (currently draft patches).
- Runner `workDir` migration (specs at repo-root `runs/<profile>/`; drops the dual-package hazard).
- Azure live token-acquisition (for `azure-keyvault` / the GPT bake-off).
- Widen metric #1 with more discovered journeys.
- Optional `LICENSE`.
