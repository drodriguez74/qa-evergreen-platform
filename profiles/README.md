# Profiles

A **profile** points the platform at one application under test. The platform is the reusable
parent; each profile overrides the parent defaults for a specific app (plan §11's
"reference + per-repo overrides" model). One profile == one **gateway repo id**, so cost, quota,
audit, and latency are attributed per target automatically.

## Schema

```jsonc
{
  "name": "fundflow",                 // required; also the gateway repo id (attribution key)
  "description": "...",
  "baseDir": "..",                    // optional; base for relative paths (default: platform repo root)
  "contract": "path/to/a11y-contract.md",   // authoritative accessible-name surface (compile facts + healer candidates)
  "api": {
    "baseURL": "http://localhost:4000",
    "openapi": "path/to/openapi.yaml",       // API coverage denominator + drift
    "resetPath": "/api/reset"
  },
  "targets": [                         // the SAME compiled spec runs against each target
    { "name": "react",   "baseURL": "http://localhost:5173" },
    { "name": "angular", "baseURL": "http://localhost:4200" }
  ],
  "gateway": { "url": "http://localhost:4100" },
  "journeys": [ { "id": "analyst-transfer-happy-path", "role": "analyst" } ]
}
```

Path fields resolve as: absolute → as-is; otherwise relative to `baseDir` (or `QA_PROFILE_BASEDIR`,
or the platform repo root).

## Selecting the active profile

```bash
QA_PROFILE=fundflow            # → profiles/fundflow.json (default)
QA_PROFILE_PATH=/path/x.json   # explicit file (e.g. a profile kept in your QA repo)
QA_PROFILE_DIR=/path/profiles  # external profiles directory to resolve QA_PROFILE against
```

## Two adoption modes

1. **Reference + overrides (built).** The platform ships parent defaults; a target app adds a thin
   profile that overrides only what differs (URL, contract, targets). Keep the profile in this repo
   (`profiles/<app>.json`) or in your own QA repo and point `QA_PROFILE_PATH` at it.
2. **Install and crawl (planned).** A `profile init <name> <url>` bootstrap that crawls the target
   and scaffolds the profile (contract/journeys discovered, not hand-written). Tracked as the next
   increment; today profiles are authored.

`fundflow.json` is the reference profile — copy it as the template for a new target.

## Onboarding a new app (the proven flow)

Demonstrated end-to-end on the live OrangeHRM demo (`orangehrm.json`). Start the gateway
(`toolkit/gateway`), then:

```bash
# 1. Discover the journey on the live target (agent-browser, profile-driven)
QA_PROFILE=orangehrm node toolkit/agents/journey_discoverer.mjs
#    → <workDir>/trace.<journeyId>.json  (+ confirms the caused state change)

# 2. Generate the Playwright spec/POM/feature from the discovered trace (gateway)
QA_PROFILE=orangehrm node toolkit/agents/test_generator.mjs
#    → <workDir>/<journeyId>/{<journeyId>.spec.ts, pages/*, .feature}
#    Each journey gets its OWN subdir + pages/ so regenerating one journey never
#    clobbers a sibling's page objects. Locators come from the trace (no contract).

# 3. Run it against the live target
cd steel-thread/thread && QA_PROFILE=orangehrm npx playwright test
```

`workDir` is per-profile (under `steel-thread/thread` so the runner's `node_modules` resolve):
`fundflow` keeps `steel-thread/thread/generated`; others get `steel-thread/thread/out/<name>`.
Override with a `workDir` field in the profile. The journey is declared in the profile's
`journeys[].steps` (role + accessible-name targets); a future `profile init` will bootstrap that by
crawling.
