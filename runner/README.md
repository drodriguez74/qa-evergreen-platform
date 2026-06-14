# `@qa-evergreen/runner` — dedicated Playwright test-runner package

The future home of the platform's Playwright runner. It exists so generated
specs **no longer have to live under `steel-thread/thread/`** just to resolve
`@playwright/test`.

## The problem this solves

Today, `toolkit/agents/test_generator.mjs` writes specs into a per-profile
`workDir` that the loader (`toolkit/profile.mjs`) places **under
`steel-thread/thread/`**:

- `fundflow`  → `steel-thread/thread/generated/`
- everything else → `steel-thread/thread/out/<profile>/`

That location is not a design choice about where tests *belong* — it's a
workaround. A generated spec does `import { test } from '@playwright/test'`, and
Node resolves that from the nearest `node_modules`. The only place
`@playwright/test` is installed is `steel-thread/thread/node_modules`, so the
specs are forced to sit under that tree. (See the loader comment: *"the
steel thread … is the test-runner home … A future platform package would own its
own runner."*) For a publishable platform, the runner should be its own package
so specs can live anywhere — e.g. repo-root `runs/<profile>/`.

## What this package provides

| File | Purpose |
| --- | --- |
| `package.json` | Private ESM package; devDep `@playwright/test@^1.60.0` (same major as `steel-thread/thread`); `test` + `test:example` scripts. |
| `playwright.config.ts` | Profile-aware config, **same shape** as `steel-thread/thread/playwright.config.ts` (testDir = `profile.workDir`, testMatch `**/*.spec.ts`, projects from `profile.targets`, `navigationTimeout` 60s, `retries` 1, headless). Imports the existing loader read-only via `../toolkit/profile.mjs`. This is the future home. |
| `playwright.example.config.ts` | Self-contained proof config — no profile, no gateway. `testDir: ./example`, hardcoded OrangeHRM live `baseURL`. |
| `example/login-happy-path.spec.ts` + `example/pages/LoginPage.ts` | A generated spec copied verbatim from `steel-thread/thread/out/orangehrm/login-happy-path/`, now living **outside** steel-thread/thread and resolving `@playwright/test` from `runner/node_modules`. |

## Setup

```bash
cd runner
npm install
npx playwright install chromium
```

## The proof — a spec OUTSIDE steel-thread/thread runs via this runner

```bash
cd runner
npm run test:example
```

Green run (live OrangeHRM, first try):

```
> @qa-evergreen/runner@0.1.0 test:example
> playwright test --config=playwright.example.config.ts

Running 1 test using 1 worker

  ✓  1 [orangehrm] › example/login-happy-path.spec.ts:16:3 › Admin logs in and reaches the dashboard › Admin successfully logs in and sees the Dashboard (5.0s)

  1 passed (6.0s)
```

`runner/example/` is not under `steel-thread/thread/`, and the only
`@playwright/test` it can reach is `runner/node_modules`. A green run therefore
proves the decoupling: the runner package can execute a generated spec from
anywhere on disk.

## Known finding: the profile-aware config can't be migrated yet (and why)

Running the **profile-aware** `playwright.config.ts` against a real profile fails
*today* — on purpose, and it's informative:

```bash
cd runner
QA_PROFILE=orangehrm npx playwright test --list
# Error: Requiring @playwright/test second time
#   First:  runner/node_modules/playwright/...
#   Second: steel-thread/thread/node_modules/playwright/...
```

The config loads fine and builds projects correctly — the loader import works.
The failure is a **dual-package hazard**: `profile.workDir` still resolves to
`steel-thread/thread/out/orangehrm/`, so the runner loads `@playwright/test` from
`runner/node_modules`, then each spec there pulls a **second** copy from
`steel-thread/thread/node_modules` (nearest to the spec). Two instances of the
runtime in one process → hard error.

This is the exact symptom that proves the workaround is still in place: as long
as specs live under a tree that has its own `@playwright/test`, you cannot run
them from a different runner. It is **not** a bug in this package — it's the
condition the migration below removes.

## Follow-up migration (NOT done here — additive scaffolding only)

Per task scope this change is purely additive. I did **not** edit
`toolkit/profile.mjs`, `steel-thread/thread/playwright.config.ts`, or anything
under `toolkit/gateway/`, `toolkit/agents/`, or `profiles/`. To actually adopt
this runner, a future increment would:

1. **Point `workDir` outside steel-thread/thread.** In `toolkit/profile.mjs`,
   change `TEST_HOME` (and the default workDir branch) so generated specs land at
   a runner-neutral location, e.g. repo-root `runs/<profile>/` and
   `runs/fundflow/generated/`. (Or set a `workDir` field per profile pointing
   there.) This removes the competing `steel-thread/thread/node_modules` from the
   spec's resolution path.
2. **Run through this package.** `cd runner && QA_PROFILE=<x> npm test`. With
   specs no longer under a tree that ships its own `@playwright/test`, they
   resolve the runner's single copy and the dual-package error disappears.
3. **Optionally drop `@playwright/test`** from `steel-thread/thread/package.json`
   once nothing under it is run directly, leaving `runner/` the sole runner.

Until step 1 lands, `playwright.config.ts` here is the staged future home;
`playwright.example.config.ts` is the working proof that the package itself runs
specs from outside steel-thread/thread.
