# QA Evergreen Ecosystem — Implementation Plan

**Organization:** Fortune 100 financial services company
**Approach:** One repo at a time · 50% coverage floor · AI-accelerated · Self-healing
**Stack:** TypeScript · Playwright · Cucumber-JS · Python (AI agents) · LLM via gateway (provider-agnostic — GPT-5.2 / Sonnet 4.6 bake-off pending) · GitLab CI
**Prepared:** June 2025

> **⚠️ Status — target-state vision, not a deployed system.** Sections 1–20 describe the destination. As of this version **nothing is built**: there is no `.gitlab-ci.yml`, no shared template, no pipelines, no cron jobs, no cleanup, and none of the AI agents exist. The near-term work is building the agents and proving the loop on one app. **Read [Section 21](#21-reality-check-provider-decision--pre-implementation-backlog) first** — it states what exists today, the LLM provider decision, and the proof-of-concept scope. Operational controls described in §11–§19 become real risks only when the layer that needs them is actually built.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Prerequisites & Non-Negotiables](#3-prerequisites--non-negotiables)
4. [Team Structure & Ownership](#4-team-structure--ownership)
5. [Phase 1 — Foundation (Weeks 1–4)](#5-phase-1--foundation-weeks-14)
6. [Phase 2 — Pilot Repo (Weeks 5–10)](#6-phase-2--pilot-repo-weeks-510)
7. [Phase 3 — Scale to 3 Repos (Weeks 11–18)](#7-phase-3--scale-to-3-repos-weeks-1118)
8. [Phase 4 — Company Rollout (Weeks 19–36)](#8-phase-4--company-rollout-weeks-1936)
9. [The Breadcrumb System](#9-the-breadcrumb-system)
10. [The Generation Pipeline](#10-the-generation-pipeline)
11. [GitLab Enforcement Model](#11-gitlab-enforcement-model)
12. [Autonomy & Self-Healing](#12-autonomy--self-healing)
13. [Brownfield Onboarding Playbook](#13-brownfield-onboarding-playbook)
14. [KPIs & Success Metrics](#14-kpis--success-metrics)
15. [Risk Register](#15-risk-register)
16. [Definition of Done — Per Repo](#16-definition-of-done--per-repo)
17. [Tooling & Infrastructure](#17-tooling--infrastructure)
18. [Open Questions & Decisions Log](#18-open-questions--decisions-log)
19. [Agent Browser Integration](#19-agent-browser-integration)
20. [Journey Discovery & Trace Compilation](#20-journey-discovery--trace-compilation)
21. [Reality Check, Provider Decision & Pre-Implementation Backlog](#21-reality-check-provider-decision--pre-implementation-backlog)

---

## 1. Executive Summary

The QA Evergreen Ecosystem is a company-wide, AI-accelerated quality automation platform that transforms QA from a manual bottleneck into a self-sustaining, autonomous function embedded directly in the development lifecycle.

### The Problem

- Manual regression cycles consume 2–3 days per sprint across teams
- Test coverage is unmeasured, inconsistent, and undocumented
- Contractor turnover erases institutional QA knowledge
- Production defects are caught days after deployment, not minutes before merge
- There is no scalable, standardized QA practice across the portfolio

### The Solution

A five-layer ecosystem where:

- **Breadcrumb artifacts** capture the complete behavioral surface of every application (pages, roles, actions, API calls) as versioned YAML files committed to the codebase
- **AI agents** derive role-scoped user journeys from those breadcrumbs, prioritized by real Dynatrace session data
- **Generation agents** produce feature files, TypeScript/Playwright POM classes, Postman collections, and Pact contract tests automatically
- **A shared GitLab CI template** enforces the ecosystem across every repo with a single one-line include
- **Self-healing agents** keep tests current autonomously — AI fixes, AI reviews, human approves

### Success Criteria

| Horizon | Metric | Target |
|---|---|---|
| 90 days | Pilot repo coverage | 50% API + 50% UI |
| 6 months | Repos onboarded | 3–5 |
| 12 months | Repos onboarded | 10+ |
| 18 months | Portfolio coverage | 80%+ repos in ecosystem |
| Ongoing | Coverage floor | Never regresses below 50% |

---

## 2. Architecture Overview

The ecosystem is organized into five layers, each with a defined input, output, and owner. Layers communicate through versioned YAML artifacts — not runtime coupling.

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: DETECTION                                             │
│  Extended workspace-analysis skill                              │
│  Input:  Source repos (frontend + backend)                      │
│  Output: .ai-sdlc/qa-profile.yaml                              │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  LAYER 2: BREADCRUMB                                            │
│  breadcrumb_emitter.py — Journey artifact generator             │
│  Input:  qa-profile.yaml + Dynatrace RUM + OpenAPI spec        │
│  Output: .ai-sdlc/qa-breadcrumbs.yaml                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  LAYER 3: GENERATION                                            │
│  generator_agent.py — Test artifact factory                     │
│  Input:  qa-breadcrumbs.yaml                                   │
│  Output: Feature files, POM classes, Postman, Pact → QA repo   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  LAYER 4: ENFORCEMENT                                           │
│  qa-ecosystem.gitlab-ci.yml — Company-wide shared template      │
│  Input:  One-line include in any repo's .gitlab-ci.yml          │
│  Output: Pass / Block / Coverage report / Email notification    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  LAYER 5: AUTONOMY                                              │
│  Self-healing agents — Continuous maintenance                   │
│  Input:  Runtime failures, drift detection, coverage deltas     │
│  Output: Draft PRs with AI review → Human approval             │
└─────────────────────────────────────────────────────────────────┘
```

### Repository Structure

The ecosystem spans three repository types:

```
platform/qa-ecosystem          ← Shared GitLab CI template + scripts (GitLab Team owns)
platform/qa-toolkit            ← AI agents, breadcrumb emitter, generator (SDET Team owns)
{app-name}-qa                  ← Per-application QA repo (SDET Team owns, per app)
```

Source application repos (frontend + backend) are **read-only** from the ecosystem's perspective. The only modification to a source repo is adding one `include:` line to `.gitlab-ci.yml` and setting CI/CD variables.

---

## 3. Prerequisites & Non-Negotiables

These are hard requirements. If any are missing, the ecosystem cannot function for a given repo. The pipeline enforces all of them.

### Rule 1 — OpenAPI Spec (Hard Prerequisite)

Every Java backend **must** expose an OpenAPI 3.x spec before onboarding. If missing:

1. Add `springdoc-openapi-starter-webmvc-ui` to `pom.xml`
2. Run the app locally and verify `/v3/api-docs` is reachable
3. Commit the generated spec to `openapi/` in the repo
4. The `qa:openapi-check` pipeline job will verify this on every run

```xml
<!-- pom.xml addition -->
<dependency>
  <groupId>org.springdoc</groupId>
  <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
  <version>2.3.0</version>
</dependency>
```

**OpenAPI Annotation Quality Bar**

Auto-generated specs from unannotated Spring controllers produce schemas with missing descriptions, incorrect nullable flags, and `object` types that cause the generator to produce low-quality or incorrect test assertions. Before onboarding proceeds, the following minimum bar must be met:

- All endpoints have `@Operation(summary=)` annotations
- All request/response DTOs use typed Java classes (no raw `Object`, `Map<String,Object>`, or `JsonNode`)
- Nullable fields are explicitly marked (Spring validation annotations or OpenAPI `nullable: true`)

The `qa:openapi-check` job validates spec presence and this quality bar. A spec that passes presence but fails quality produces a `WARNING` in the pipeline output and creates a mandatory "OpenAPI annotation review" item in the onboarding Jira ticket. Onboarding cannot complete until this item is resolved.

### Rule 2 — Source Code Read Access

The `qa-toolkit` service account must have `read_repository` access to:

- Frontend React repo
- Backend Java/Spring repo
- Any shared component libraries used by the frontend

This is provisioned once per application, not per developer.

**CMS-configured applications:** most target apps (money movement, fraud, disputes, chargebacks) are CMS-style workflow tools where screens, fields, role assignments, and workflow states live in *configuration*, not hand-written frontend code. For these, an exportable configuration dump replaces or supplements source access — it is the more authoritative inventory (Section 20.4). Provision read access to the config export API or a scheduled config dump alongside (or instead of) repository access.

### Rule 3 — Dynatrace API Token

A read-only Dynatrace API token with `DataExport` and `ReadSyntheticData` scopes must be provisioned and stored as a GitLab CI/CD variable (`DYNATRACE_TOKEN`) in the application's GitLab group. If unavailable, set `QA_TELEMETRY_SOURCE=static` — the system falls back to static analysis, but journey prioritization will be less accurate.

### Rule 4 — GitLab Runner Compute

The following runner configurations are required:

| Job Type | Image | Minimum Runners |
|---|---|---|
| TypeScript tests (UI + API) | `mcr.microsoft.com/playwright:v1.44.0-jammy` | 6 concurrent |
| Python agents (AI + reporting) | `python:3.12-slim` | 2 concurrent |
| Regression (cron) | Both above | 8 concurrent |

### Rule 5 — Two Approvals Already Enforced

Confirmed: all MR merges require two human approvals. The ecosystem's QA coverage gate adds a third **non-human gate** — the pipeline must pass. This is enforced via GitLab branch protection rules (the `qa:coverage-gate` job must succeed before merge is permitted).

### Rule 6 — Secret Management

All tokens and API keys used by the ecosystem must be:

- Stored as **masked + protected** GitLab CI/CD variables at the **group level** (`platform/`), never at individual project level
- Named with the `QA_` prefix for namespace isolation
- Rotated every 90 days (a scheduled audit job in `platform/qa-ecosystem` alerts when tokens are approaching expiry)
- Never echoed to pipeline logs (GitLab's `masked` flag enforces this; the CI template explicitly uses `--no-verbose` flags on any command that could print token values)
- **The LLM credential is never exposed directly to consumer repo pipelines.** Masking is not exfiltration-proof (base64 trivially defeats it), and a group-level key readable by every included pipeline is a company-wide blast radius. The platform uses **Azure OpenAI** (§21.2) — agents authenticate to the model gateway in `platform/qa-toolkit` via Azure AD / managed identity, and any API key lives in **Azure Key Vault**, never as a group-level GitLab variable. The gateway enforces per-repo quotas and provides the per-repo cost attribution the KPI dashboard needs.

The `qa-toolkit` service account uses purpose-scoped tokens:

| Scope | Access Level | Rationale |
|---|---|---|
| Source repos | `read_repository` only | No write, no API — git clone only |
| QA repos | `developer` role | Minimum to open draft MRs |
| GitLab API | `api` scope, `platform/` group only | Scoped to prevent lateral access |
| Jira | `write:jira-work` only | File tickets, no read of unrelated projects |

### Rule 7 — Role-Scoped Test Accounts & Synthetic Data (Hard Prerequisite)

Every role in the breadcrumb role model (`admin`, `super-user`, `user`, `pilot`) requires a dedicated test account in every environment under test. Without them, role-scoped journeys (`@role-admin`, role-boundary scenarios) cannot execute, and no agent-browser verification job can authenticate. Provisioned during onboarding Week 1, owned by the app team:

- **Credentials** stored as masked GitLab CI/CD variables (`QA_CRED_{ROLE}_USER` / `QA_CRED_{ROLE}_PASS`) at project level. For local and agent use, the same credentials are registered in the agent-browser auth vault (`agent-browser auth save {app}-{role} --url $QA_BASE_URL --username ... --password-stdin`), with state encrypted via `AGENT_BROWSER_ENCRYPTION_KEY` and auto-expired via `AGENT_BROWSER_STATE_EXPIRE_DAYS=7`.
- **Synthetic data only.** Test environments must contain no production or cardholder data (PCI-DSS scope). All entities are created by faker-js factories. Any DOM snapshot, screenshot, or log shipped to an AI agent is therefore synthetic by construction.
- **Per-run namespacing.** Parallel pipelines share one dev environment. Every entity a test creates is prefixed `qa-{CI_PIPELINE_ID}-` so concurrent MR pipelines and the `parallel: 6` regression runners never mutate each other's state. A nightly cleanup job deletes entities older than 48 hours.

---

## 4. Team Structure & Ownership

### Core Team

| Role | Responsibility | Headcount |
|---|---|---|
| **QA Architect / Lead SDET** | Ecosystem design, AI agent quality, breadcrumb schema ownership | 1 |
| **Senior SDET** | QA repo development, POM library, step definition standards | 2 |
| **GitLab Engineer** | Shared CI template, runner config, branch protection rules | 1 (from dedicated GitLab team) |
| **DevOps Engineer** | Docker images, runner scaling, Dynatrace integration | 1 (part-time) |

### Extended Team (Per Repo Onboarding)

| Role | Responsibility |
|---|---|
| **App Dev Lead** | Approve one-line CI include, confirm OpenAPI spec, write feature files for new features (DoD) |
| **App QA Champion** | First reviewer of generated breadcrumbs and test artifacts for that app, ongoing test ownership |

### Ownership Matrix

| Artifact | Owner | Can Modify | Requires Approval From |
|---|---|---|---|
| `qa-ecosystem.gitlab-ci.yml` | GitLab Team | GitLab Team | QA Architect |
| `qa-profile.yaml` | Generated | No hand-editing | — |
| `qa-breadcrumbs.yaml` | Generated | SDET (corrections only) | QA Architect |
| Feature files (`*.feature`) | SDET / Dev | Anyone | 2 approvals (MR rule) |
| POM classes (`*Page.ts`) | SDET | SDET | 1 SDET approval |
| Step definitions (`*.steps.ts`) | SDET | SDET | 1 SDET approval |
| AI agent prompts | QA Architect | QA Architect | — |
| Coverage gate thresholds | GitLab Team | Per-repo CI variable | QA Architect |

---

## 5. Phase 1 — Foundation (Weeks 1–4)

**Goal:** Build the shared infrastructure before touching any application repo. Everything built here is reused for every future onboarding.

### Week 1 — Repository & Tooling Setup

**GitLab Team:**

- [ ] Create `platform/qa-ecosystem` repo with protected `main` branch
- [ ] Create `platform/qa-toolkit` repo with protected `main` branch
- [ ] Configure shared GitLab runners with Playwright and Python images
- [ ] Set up `platform/` GitLab group with shared CI/CD variables:
  - `QA_SCRIPTS` — path to shared Python scripts
  - `QA_AZURE_OPENAI_ENDPOINT` — Azure OpenAI endpoint; auth via Azure AD / managed identity, any key in Azure Key Vault. Held by the `platform/qa-toolkit` gateway only (Rule 6 — consumer repo pipelines call the gateway, never the credential)
  - `QA_DEFAULT_COVERAGE_GATE` — `50`

**SDET Team:**

- [ ] Bootstrap `platform/qa-toolkit` with project structure:

```
qa-toolkit/
├── agents/
│   ├── breadcrumb_emitter.py      # Layer 2 — source/config → breadcrumb skeleton (Lane C)
│   ├── journey_discoverer.py      # Layer 2 — agent-browser discovery, Lanes A+B (§20)
│   ├── journey_deriver.py         # Layer 2 — proposes exploration goals for Lane B (§20)
│   ├── trace_compiler.py          # Layer 3 — recorded trace → .feature/steps/POM (§20.3)
│   ├── generator_agent.py         # Layer 3 — breadcrumbs → test artifacts
│   ├── scope_detector.py          # Layer 4 — git diff → TEST_TAGS
│   ├── locator_healer.py          # Layer 5 — broken locator → patch PR
│   ├── drift_detector.py          # Layer 5 — breadcrumb diff → action
│   ├── coverage_audit.py          # Layer 5 — weekly gap analysis
│   ├── flakiness_quarantine.py    # Layer 5 — intermittent fail → @flaky
│   └── report_narrator.py         # Layer 4 — AI failure summary
├── parsers/
│   ├── react_route_parser.py      # Handles central / file-based / modular
│   ├── cms_config_parser.py       # Reads CMS config export → pages/roles/workflow (§20.4)
│   ├── spring_role_extractor.py   # Reads @PreAuthorize + Redux auth slices
│   ├── openapi_mapper.py          # Maps OpenAPI → api_surface schema
│   └── dynatrace_prioritizer.py   # Fetches session data → priority scores
├── templates/
│   ├── feature.jinja2             # Gherkin feature file template
│   ├── steps.jinja2               # TypeScript step definition template
│   ├── page_object.jinja2         # Playwright POM class template
│   └── postman.jinja2             # Postman collection template
├── reporting/
│   ├── coverage_delta.py          # Δ coverage vs last run
│   ├── coverage_gate.py           # Pass/fail against threshold
│   └── email_sender.py            # jinja2 HTML + smtplib
├── schemas/
│   └── qa-breadcrumbs.schema.json # JSON Schema for breadcrumb validation
├── requirements.txt               # openai[azure] gitpython bs4 jinja2 pyyaml
└── tests/                         # Unit tests for the agents themselves
```

### Week 2 — Breadcrumb Emitter (Layer 2)

**Deliverables:**

- [ ] `react_route_parser.py` — detects routing strategy from `qa-profile.yaml` and parses accordingly. Supports four strategies:
  - `central_routes` — reads `src/routes.tsx` or `src/App.tsx`
  - `file_based` — traverses `src/pages/` directory structure (Next.js style)
  - `modular` — reads each feature module's route registration file
  - `cms_config` — delegates to `cms_config_parser.py`: reads the CMS configuration export (screens, fields, role assignments, workflow states) as the authoritative inventory for CMS-built apps (Section 20.4)
- [ ] `spring_role_extractor.py` — extracts role model using a priority-ordered fallback chain:
  1. `@PreAuthorize` annotations on controllers (most common)
  2. `@RolesAllowed` and `@Secured` annotations (older Spring Security)
  3. `HttpSecurity` configuration blocks in `SecurityConfig.java` (programmatic assignments)
  4. **Manual override:** if `qa-profile.yaml` contains a `role_override` block, it takes precedence over all parsed values — used for apps with ACL tables, custom `PermissionEvaluator` beans, or method-level security that static analysis cannot resolve
  Cross-references Redux auth slice (`authSlice.ts`) for UI-side role guards to confirm role names match frontend and backend
- [ ] `dynatrace_prioritizer.py` — queries Dynatrace Sessions API for page-level session counts over last 90 days. Returns priority map: `{route: "high"|"medium"|"low"}`
- [ ] `openapi_mapper.py` — reads OpenAPI YAML/JSON spec, extracts all endpoints grouped by tag/module with HTTP method and path
- [ ] `journey_deriver.py` — calls the model (via the gateway) to propose candidate journeys (exploration goals) from page graph + role permission map. **Proposals do not enter the breadcrumb directly** — they are handed to `journey_discoverer.py`, which attempts each one via agent-browser; only demonstrated journeys (with recorded traces) become `journeys[]` entries (Section 20)
- [ ] `breadcrumb_emitter.py` — orchestrates all parsers, writes `qa-breadcrumbs.yaml`, diffs against previous version and emits drift events

**Breadcrumb schema validation:** All generated breadcrumb files must validate against `qa-breadcrumbs.schema.json` before being committed. Invalid schema = pipeline fails.

### Week 3 — Generator Agent (Layer 3)

**Deliverables:**

- [ ] `feature.jinja2` template — produces valid Gherkin with `@role-{role}`, `@{module}`, `@{priority}` tags. Generates Background block for auth setup. Includes Scenario Outline with Examples table for parameterized cases
- [ ] `steps.jinja2` template — produces TypeScript step definitions with `async function(this: World)` pattern, correct `@cucumber/cucumber` imports, and TODO markers for SDET to complete
- [ ] `page_object.jinja2` template — produces Playwright `Page` class extending `BasePage`, with typed `Locator` properties using `getByRole`/`getByLabel`/`getByTestId`, and action methods
- [ ] `postman.jinja2` template — produces v2.1 Postman collection from OpenAPI spec with environment variables for base URL and auth token
- [ ] `generator_agent.py` — reads breadcrumbs, calls templates, calls the model (via the gateway) for scenario wording and edge case suggestions, writes all artifacts to a staging directory, opens draft PR in target QA repo

### Week 4 — Shared CI Template (Layer 4)

**Deliverables:**

- [ ] `qa-ecosystem.gitlab-ci.yml` — complete shared template (see Section 11 for full spec)
- [ ] `check_openapi.py` — validates OpenAPI spec presence and parsability. Attempts auto-generation via springdoc if Spring Boot detected
- [ ] `check_breadcrumbs.py` — validates freshness: checks `openapi_hash` matches current spec, checks all React routes are represented, checks file is not older than last source commit
- [ ] `coverage_gate.py` — reads `allure-results/` JSON, computes coverage percentage, posts MR comment with delta, fails if below threshold
- [ ] Documentation: `README.md` in `platform/qa-ecosystem` with adoption instructions

---

## 6. Phase 2 — Pilot Repo (Weeks 5–10)

**Goal:** Prove the pattern on one production application. Achieve 50% coverage floor. Make the win visible and undeniable.

### Pilot Repo Selection Criteria

Select the pilot repo based on:

- React + Java/Spring Boot stack (confirmed)
- Has an OpenAPI spec or can generate one quickly
- Has an active Dynatrace application
- Dev team is willing to participate (designate a QA Champion)
- Moderate size — not the largest or most complex system in the portfolio
- Has clear role-based access (admin / user roles at minimum)

### Week 5 — Pilot Prerequisites

- [ ] Run `workspace-analysis` on both frontend and backend repos. Commit `qa-profile.yaml`
- [ ] Verify OpenAPI spec is present and accurate. Fix any missing endpoint documentation
- [ ] Provision Dynatrace API token for pilot application group
- [ ] Create `{pilot-app}-qa` repo. Bootstrap with Playwright + Cucumber-JS:

```bash
npm init -y
npm install --save-dev @playwright/test @cucumber/cucumber \
  allure-cucumberjs @cucumber/pretty-formatter \
  axios zod faker-js typescript ts-node \
  @types/node dotenv
npx playwright install chromium firefox webkit
```

- [ ] Confirm `platform/qa-ecosystem` include is accessible from pilot repo's GitLab group

### Week 6 — Breadcrumb Generation & Review

- [ ] Run `breadcrumb_emitter.py` against pilot source repos
- [ ] Run the agent-browser verification crawl (`breadcrumb_verifier.py`, Section 19.1) per role against dev — diff discovered pages/actions vs the generated breadcrumbs
- [ ] Review generated `qa-breadcrumbs.yaml` with SDET team:
  - Verify page inventory is complete (review the crawl diff report — not hand-navigation)
  - Verify roles map correctly (confirm with dev lead)
  - Review journey derivation — correct any illogical sequences
  - Confirm Dynatrace priority scores look reasonable
- [ ] Commit reviewed breadcrumbs to QA repo (not source repo)
- [ ] Document any corrections made — these feed back into emitter improvements

### Week 7 — Generate First Test Suite

- [ ] Run `generator_agent.py` against reviewed breadcrumbs
- [ ] AI code review runs automatically on all generated artifacts
- [ ] SDET reviews draft PR in QA repo:
  - Feature files: verify scenario wording is accurate and testable
  - POM classes: every generated locator pre-validated by the agent-browser pass (Section 19.2) — SDET manually reviews only the flagged failures
  - Step definitions: complete the TODO implementations
  - Postman collection: import and verify against live API
- [ ] Merge approved artifacts to QA repo `main`
- [ ] First manual test run to verify everything executes: `npx cucumber-js --tags "@smoke"`

### Week 8 — Pipeline Integration

- [ ] Add to pilot source repo `.gitlab-ci.yml`:

```yaml
include:
  - project: 'platform/qa-ecosystem'
    ref: v1.0.0   # ALWAYS pin to a release tag — never `main`. A floating
                  # `main` ref means one bad template change is an instant
                  # company-wide merge freeze across every consuming repo.
    file: 'qa-ecosystem.gitlab-ci.yml'
```

- [ ] Set CI/CD variables in pilot repo:

```
QA_ECOSYSTEM_ENABLED    = true
QA_BROWNFIELD_MODE      = true      # soft mode during onboarding
QA_COVERAGE_GATE        = 50
QA_TELEMETRY_SOURCE     = dynatrace
QA_REPO_PATH            = $CI_BUILDS_DIR/{pilot-app}-qa   # see checkout note below
QA_BASE_URL             = https://{pilot-app}.dev.example.com
QA_REPORT_EMAIL         = qa-team@example.com,dev-lead@example.com
DYNATRACE_TOKEN         = [provisioned token]
```

> **QA repo checkout mechanism:** The `qa:run-feature-tests` and `qa:regression` jobs run in the *source* repo's pipeline — the QA repo is not automatically checked out. The shared template's `before_script` for these jobs clones it using a git credential helper — never a token embedded in the URL (tokens in URLs leak into process listings, error messages, and verbose git output):
> ```bash
> git -c credential.helper='!f(){ echo "username=qa-toolkit-token"; echo "password=${QA_TOOLKIT_TOKEN}"; };f' \
>   clone --depth 1 "https://gitlab.example.com/{app}-qa.git" "$QA_REPO_PATH"
> ```
> `QA_TOOLKIT_TOKEN` is a read-only Deploy Token scoped to the QA repo, stored as a masked CI/CD variable at `platform/` group level. Adds ~15–20 seconds per job. `QA_REPO_PATH` should use `$CI_BUILDS_DIR` as the base to ensure it lands on the runner's fast disk.

> **Parallel artifact namespacing & sharding:** The `qa:regression` job uses `parallel: 6`. Cucumber-JS does **not** shard across CI nodes natively — the shared template splits the suite deterministically by hashing each feature file path modulo `$CI_NODE_TOTAL` and passing the resulting file list to each node. Each instance writes to `allure-results-$CI_NODE_INDEX/` — not `allure-results/` — to prevent artifact collision. The `qa:report` job runs after all instances complete and merges them: `allure generate allure-results-{1..6} -o allure-report`. The shared template handles both automatically.

- [ ] Open a test MR and verify all QA pipeline jobs are visible and running
- [ ] Verify email report is delivered on first regression cron run
- [ ] Set up cron schedules in GitLab UI:
  - "Regression Tue" → `0 6 * * 2` → `main`
  - "Regression Thu" → `0 6 * * 4` → `main`

### Weeks 9–10 — Coverage Climb to 50% Floor

- [ ] Coverage audit agent runs — generates Jira tickets for uncovered modules
- [ ] SDET team backfills highest-priority gaps (guided by Dynatrace priority scores)
- [ ] AI generates draft feature files for uncovered journeys — SDET reviews and merges
- [ ] Validate self-healing: intentionally modify a locator in the app, observe healer detect and patch it
- [ ] Confirm coverage floor: `API ≥ 50%` and `UI ≥ 50%` in Allure report
- [ ] Set `QA_BROWNFIELD_MODE=false` — full enforcement now active
- [ ] **Pilot retrospective:** document what worked, what needed manual correction, estimated time savings
- [ ] Present results to leadership and next two candidate teams

---

## 7. Phase 3 — Scale to 3 Repos (Weeks 11–18)

**Goal:** Onboard two more repos in parallel. Validate that the pattern is repeatable without the founding team doing all the work.

### Weeks 11–12 — Repo Selection & Parallel Kickoff

- [ ] Select two additional repos using the same pilot criteria
- [ ] Designate a QA Champion on each app team
- [ ] QA Champions attend 2-hour onboarding workshop (created from pilot learnings):
  - What is a breadcrumb and why it matters
  - How to read and correct a generated feature file
  - Developer responsibility: write `.feature` for new features (DoD)
  - How to read the email report and act on it
- [ ] Run prerequisites check on both repos simultaneously

### Weeks 13–16 — Parallel Onboarding

Each repo follows the same 6-week brownfield playbook (Section 13). With two repos in flight:

- SDET A owns Repo 2 breadcrumb review and test approval
- SDET B owns Repo 3 breadcrumb review and test approval
- QA Architect reviews all AI agent outputs and breadcrumb corrections
- GitLab Engineer monitors runner load and scales if needed

### Weeks 17–18 — Ecosystem Improvements

After three repos are running, the pattern will have surfaced improvements:

- [ ] Refine `journey_deriver.py` prompt based on correction patterns from all three repos
- [ ] Add any new React routing patterns discovered to `react_route_parser.py`
- [ ] Update `qa-ecosystem.gitlab-ci.yml` to `v1.1.0` with any pipeline improvements
- [ ] Publish internal adoption guide: "How to onboard your repo in one sprint"
- [ ] Create self-service onboarding request process (GitLab issue template)

---

## 8. Phase 4 — Company Rollout (Weeks 19–36)

**Goal:** Scale to 10+ repos. Transition from founding team driving every onboarding to teams self-serving with light SDET support.

### Weeks 19–24 — Accelerated Onboarding (5 Repos)

- Target: 5 additional repos onboarded in 6 weeks
- Each onboarding takes 1 sprint with a trained QA Champion and the published guide
- SDET team provides office hours (2 hours/week per active onboarding) rather than hands-on ownership
- GitLab team monitors shared runner utilization and scales ahead of demand

### Weeks 25–36 — Self-Service Rollout

- Teams request onboarding via GitLab issue template
- QA Champions trained by existing QA Champions (train-the-trainer model)
- SDET team focuses on ecosystem improvements, not individual repo onboarding
- Monthly ecosystem health report: repos onboarded, average coverage, self-healing stats, ROI metrics

### Coverage Targets by Milestone

| Week | Repos in Ecosystem | Avg Coverage |
|---|---|---|
| 10 | 1 (pilot) | 50% |
| 18 | 3 | 55% |
| 24 | 8 | 60% |
| 36 | 15+ | 70%+ |

---

## 9. The Breadcrumb System

Breadcrumbs are the foundational artifact of the entire ecosystem. They are the machine-readable answer to: **"What does this application do, who can do it, and how important is it?"**

### What a Breadcrumb Captures

For every application module, the breadcrumb YAML records:

- **Pages** — every React route, the component that renders it, which roles can access it
- **Actions** — every meaningful user interaction on that page (filter, submit, navigate, export), the role required, and which API calls it triggers
- **Journeys** — named sequences of pages and actions that represent a coherent user goal, with role scope and priority level
- **API Surface** — every endpoint from the OpenAPI spec, grouped by module, with coverage status
- **Priority** — derived from Dynatrace session counts (or static heuristics as fallback)
- **Provenance** — every page, action, and journey carries `discovered_by: static | dynamic | both` plus an `evidence:` block (trace, HAR, screenshot) when demonstrated by the discovery agent (Section 20.2)
- **Metadata** — generator version, generation timestamp, OpenAPI hash (for freshness detection)

### Freshness Enforcement

The breadcrumb file is considered stale when any of the following is true:

- The `openapi_hash` field does not match the current spec hash
- A React route exists in source that is not in the breadcrumb `pages[]` list
- The `source_commit` field in `meta:` does not match the source repo's HEAD SHA for any path under `src/` (commit-SHA comparison only — never file mtime, which shallow `--depth 1` clones reset to checkout time)

When stale, the `qa:breadcrumb-check` job fails with instructions to re-run the emitter. This ensures breadcrumbs never silently drift from the application.

### Breadcrumb Corrections

The emitter is AI-assisted but not perfect. SDETs may correct generated breadcrumbs. Corrections must be:

- Made in the breadcrumb file directly (it is a valid source file)
- Committed with a message starting with `fix(breadcrumbs):`
- Documented in the PR description so corrections feed back into emitter improvements

### Drift Event Format

`DriftDetector.diff_and_emit()` writes `.ai-sdlc/drift-events.yaml` on every breadcrumb regeneration. This is the contract that Layer 5 agents consume — each event type maps to exactly one agent action:

```yaml
events:
  - type: action_renamed      # → locator_healer.py
    page_id: dispute-detail
    old_action: submit-btn
    new_action: resolve-action
    timestamp: 2025-06-15T10:22:00Z
  - type: page_added          # → generator_agent.py
    page_id: dispute-notes
    route: /disputes/:id/notes
    timestamp: 2025-06-15T10:22:00Z
  - type: page_removed        # → drift_detector.py (retirement PR)
    page_id: legacy-export
    timestamp: 2025-06-15T10:22:00Z
```

Valid event types: `page_added` | `page_removed` | `action_added` | `action_renamed` | `role_added` | `role_removed` | `api_endpoint_added` | `api_endpoint_removed`. Unknown event types are logged as warnings and do not trigger agent actions. The file is committed to the QA repo alongside the regenerated breadcrumbs.

### Coverage Metric — Explicit Definition

"50% coverage" is used throughout this document. It means exactly:

- **UI Coverage %** = `(journeys with ≥1 passing automated scenario) ÷ (total demonstrated journeys in breadcrumbs)`. This is journey coverage, not line coverage. A journey with 5 scenarios counts once — covered or not. **The denominator is demonstrated journeys only** — entries flagged `undemonstrated: true` (proposed but not yet proven achievable by a recorded trace, §20.2) are excluded from both numerator and denominator until demonstrated. This is the single authoritative denominator definition; §20 conforms to it.
- **API Coverage %** = `(OpenAPI endpoints with ≥1 test that validates status code AND response schema via zod) ÷ (total endpoints in spec)`. A test that only checks `status 200` without schema validation is not counted. Pact consumer contracts only count once the provider runs `pact:verify` and the result is published to the Pact Broker — consumer-only contracts are flagged as `partial` in `coverage-manifest.json`.

These numbers come from `coverage_gate.py` reading `coverage-manifest.json` and `allure-results/`. They are the only numbers that count toward the 50% gate.

### Priority Levels and Their Effect

| Priority | Source | Coverage Target | Scenario Depth |
|---|---|---|---|
| `high` | Dynatrace top 25% by session count | 100% | All roles · Happy path · 3+ negatives · Edge cases |
| `medium` | Dynatrace 25–75th percentile | 60% | Primary roles · Happy path · 2 negatives |
| `low` | Dynatrace bottom 25% / static fallback | 20% | Smoke test only |
| `pilot` | Pages accessible only to `pilot` role | Isolated | Separate `@demo` suite |

> **New-feature override:** Session counts punish exactly the code most likely to break — a page shipped last sprint has zero sessions and would land in `low`. Any page or journey younger than the 90-day telemetry window defaults to `high` until it has a full window of real data. Zero sessions means *new*, not *unimportant*.

---

## 10. The Generation Pipeline

The generator agent reads `qa-breadcrumbs.yaml` and produces the complete test artifact suite. All output goes to the target QA repo as a draft PR, never directly to `main`.

### Generated Artifacts Per Journey

For each journey entry in the breadcrumb file, the generator produces:

**1. Gherkin Feature File** (`features/{type}/{module}/{journey-id}.feature`)

- One file per journey
- Tags: `@role-{role}`, `@{module}`, `@{priority}`, `@smoke` or `@regression`
- Background block with authentication setup
- Primary scenario (happy path)
- Scenario Outlines for parameterized negative cases
- Separate scenarios for role-boundary checks (e.g., "user cannot access admin action")

**2. TypeScript Step Definition Scaffold** (`steps/{module}/{journey-id}.steps.ts`)

- Correct `@cucumber/cucumber` imports
- `async function(this: World)` pattern throughout
- All steps present with TODO markers for implementation
- Typed World context with page object references

**3. Playwright POM Class** (`pages/{ComponentName}Page.ts`)

- Extends `BasePage`
- One file per unique page component (deduplicated across journeys)
- Locators as typed `Locator` properties using semantic Playwright locators:
  - Preferred: `getByRole()`, `getByLabel()`, `getByPlaceholder()`
  - Acceptable: `getByTestId()` if `data-testid` attributes exist
  - Last resort: `locator('css')` — flagged with a comment for AI healer monitoring

**4. Postman Collection** (`postman/{module}-collection.json`)

- One collection per module
- All endpoints from OpenAPI spec for that module
- Environment variables for `{{base_url}}`, `{{auth_token}}`
- Pre-request scripts for auth token refresh
- Test assertions for status codes and response schema

**5. Pact Provider Verification (Required for API Coverage Credit)**

Consumer contracts are seeded from the breadcrumb `api_calls[]` data — the endpoints, parameters, and response fields the frontend *actually uses* — never from the provider's OpenAPI spec alone. Generating both sides of a contract from the provider spec would verify the spec against itself and defeat the purpose of consumer-driven contracts; the breadcrumb action map is what makes the consumer side genuinely consumer-derived.

Generated consumer Pact contracts are not counted toward API coverage until the provider verifies them. The generation pipeline also produces:

- A `pact-provider-job.yml` snippet the Java backend team adds to their pipeline — a single copy-paste addition
- A `mvn pact:verify` call that publishes results to the shared Pact Broker (`platform/pact-broker`)
- A `can-i-deploy` check in the backend's pipeline that blocks merge if the provider verification fails

Until provider verification passes, endpoints are listed as `consumer-only: true` in `coverage-manifest.json` and do not count toward the 50% API floor. The coverage gate displays them as a separate `partial` bucket so gaps are visible without blocking onboarding.

**Context Window Management**

When a brownfield application has more than 150 journeys, the generator agent splits processing by module. Each model call receives: (1) one module's breadcrumb entries, (2) the relevant OpenAPI endpoints for that module only, and (3) up to 3 existing feature files from that module as style examples. No single prompt exceeds 80k tokens. Module completion state is tracked in `coverage-manifest.json` so interrupted generation runs resume from the correct module rather than starting over.

**6. Coverage Manifest Update** (`.ai-sdlc/coverage-manifest.json`)

- Updated to reflect newly generated coverage
- Tracks: total journeys, covered journeys, coverage % per module and overall

### Developer-Written Tests (Greenfield)

For new features in greenfield repos, the developer is responsible for writing the `.feature` file as part of their Definition of Done. The generator scaffolds step definitions and POM from that feature file automatically. This means:

- Developer writes: `features/ui/{module}/{feature}.feature`
- Generator produces: matching `*.steps.ts` scaffold + POM class additions
- SDET reviews and completes implementations

This is enforced in the DoD — PRs without a corresponding `.feature` file for new user-facing features are blocked by the `qa:breadcrumb-check` job.

---

## 11. GitLab Enforcement Model

### Shared Template Structure

The `platform/qa-ecosystem` repo contains:

```
qa-ecosystem/
├── qa-ecosystem.gitlab-ci.yml     # The shared template (versioned)
├── CHANGELOG.md                   # Version history
├── scripts/
│   ├── check_openapi.py
│   ├── check_breadcrumbs.py
│   ├── scope_detector.py
│   ├── coverage_gate.py
│   ├── coverage_delta.py
│   └── email_sender.py
└── README.md                      # Adoption guide
```

### Pipeline Jobs Summary

| Job | Stage | Trigger | Blocks Merge | Image |
|---|---|---|---|---|
| `qa:openapi-check` | `.pre` | Always (if enabled) | Yes | `python:3.12-slim` |
| `qa:breadcrumb-check` | `.pre` | MR + schedule (if not brownfield) | Yes | `python:3.12-slim` |
| `qa:scope-detect` | `qa-analysis` | MR only | No | `python:3.12-slim` |
| `qa:run-feature-tests` | `qa-test` | MR only | Yes | `playwright:jammy` |
| `qa:regression` | `qa-test` | Schedule only | No | `playwright:jammy` |
| `qa:coverage-gate` | `qa-report` | Always (if enabled) | Yes | `python:3.12-slim` |
| `qa:report` | `qa-notify` | Always | No | `python:3.12-slim` |

### MR Pipeline Semantics — Test the MR's Build, Not Yesterday's Deploy

A UI test job can only be a valid merge gate if the environment it tests **contains the MR's code**. Pointing `qa:run-feature-tests` at a shared dev URL validates the *currently deployed* build, not the change under review. The template supports two explicit modes, selected via `QA_TARGET_MODE`:

| Mode | How it works | Gate semantics |
|---|---|---|
| `review` (preferred) | The repo deploys a review app per MR (`environment: review/$CI_COMMIT_REF_SLUG`). QA test jobs declare `needs: [deploy:review]` and `QA_BASE_URL` is overridden with the review app URL. | `qa:run-feature-tests` **blocks merge** — it is testing the MR's build. |
| `dev-canary` (fallback) | No review apps available. QA test jobs run against the shared dev environment. | `qa:run-feature-tests` is **informational** (`allow_failure: true`) — only `qa:openapi-check`, `qa:breadcrumb-check`, and `qa:coverage-gate` block. The blocking UI run happens post-merge against dev, with an auto-revert-on-red policy owned by the app team. |

There is no third mode. A repo that runs MR UI tests against shared dev *and* lets them block merge is gating developers on an environment their change hasn't reached — the template refuses that configuration (`QA_TARGET_MODE` unset + blocking UI job = pipeline config error). `dev-canary` mode additionally requires the per-run data namespacing from Rule 7, since concurrent pipelines share environment state.

### Feature Flag Variables

All behavior is controlled by per-repo CI/CD variables. No changes to the shared template are needed for per-repo customization.

| Variable | Default | Effect |
|---|---|---|
| `QA_ECOSYSTEM_ENABLED` | `false` | Master switch — must be explicitly set to `true` |
| `QA_BROWNFIELD_MODE` | `false` | Disables breadcrumb freshness hard gate (onboarding window only) |
| `QA_COVERAGE_GATE` | `50` | Minimum coverage % to pass the gate job |
| `QA_TELEMETRY_SOURCE` | `static` | Set to `dynatrace` to enable session-based prioritization |
| `QA_REPORT_EMAIL` | — | Comma-separated email list for regression reports |
| `QA_REPO_PATH` | — | Path to the application's QA repo on the runner |
| `QA_AUTOHEALER_AUTOMERGE` | `true` | Set to `false` to disable all auto-merging for regulated environments (SOX, PCI-DSS, HIPAA). All healer PRs then require explicit SDET approval regardless of confidence score. |
| `QA_BASE_URL` | — | Base URL of the application under test (e.g., `https://app.dev.example.com`). Required — all Playwright and API tests use this. Set at group level for dev, override at project level for staging/prod pipeline runs. |
| `QA_HEAL_CONFIDENCE_THRESHOLD` | `90` | Minimum confidence score for locator healer auto-merge eligibility. Raise to `95` or `100` for high-risk repos. |
| `QA_TOOLKIT_TOKEN` | — | Read-only Deploy Token for cloning the QA repo onto the runner. Scoped to the specific QA repo only. Set at project level. |
| `QA_TARGET_MODE` | — | `review` or `dev-canary` (see MR Pipeline Semantics above). Required when `QA_ECOSYSTEM_ENABLED=true` — determines whether `qa:run-feature-tests` blocks merge. |

> **Empty `TEST_TAGS` guard:** If `scope_detector.py` finds no relevant changed modules (e.g., a docs-only commit or a new config file), `$TEST_TAGS` is set to `@smoke` rather than left empty. An empty `--tags` flag in Cucumber runs the entire suite, which is never the intent on an MR pipeline. The `scope_detector.py` script enforces this fallback explicitly.

> **Model outage guard:** `qa:scope-detect` sits on the MR critical path and calls the model. An Azure OpenAI outage or rate-limit must never become a company-wide merge freeze: on any API error (timeout, 429, 5xx) **within a hard 30s timeout + 1 retry**, `scope_detector.py` falls back to `TEST_TAGS=@smoke`, exits 0, and emits a `DEGRADED MODE: static scope fallback` warning in the job log and MR comment. The same fail-open-to-smoke rule applies to any agent on a blocking path; agents on non-blocking paths (healer, narrator) fail closed and retry on the next run.

### Branch Protection Integration

The `qa:coverage-gate` job is added to the list of **required status checks** on the `main` branch via GitLab branch protection rules. This means:

- The two required human approvals are unchanged
- The pipeline must also pass (including the coverage gate) before merge is available
- This is configured once per repo by the GitLab team during onboarding

---

## 12. Autonomy & Self-Healing

### Trust Levels by Change Type

| Event | System Action | Auto-Merge? | Approval Required |
|---|---|---|---|
| Locator fails (CSS/XPath stale) | Healer patches POM, opens draft PR, AI reviews | Yes — 24h if ≥ 90% confidence | SDET can reject |
| Component renamed | Regenerate POM + steps, open draft PR, AI reviews | No | SDET required |
| New page added | Generate feature + POM + steps, open draft PR, AI reviews | No | SDET required |
| Page removed | Flag tests as `@deprecated`, open draft PR | No | SDET required |
| New API endpoint | Generate API scenario, open draft PR, AI reviews | No | SDET required |
| Test flaky 3x | Auto-tag `@flaky`, move to quarantine suite, file Jira | Yes — immediate | No approval needed |
| Coverage drops below gate | Block pipeline, notify via email | N/A — hard gate | Fix coverage to unblock |
| Coverage audit gap found | Open Jira ticket with generated feature stubs | N/A | SDET picks up ticket |

### AI Code Review Format

Every draft PR opened by an autonomous agent includes an AI code review comment with:

```
### AI Code Review — Locator Healer

**Confidence:** 94%
**Change type:** Locator patch (low blast radius)
**Reason:** CSS selector `.btn-submit` no longer resolves on DisputeDetailPage.
  Found matching element via role attribute: `button[aria-label="Submit Resolution"]`

**Recommendation:** APPROVE — semantic locator is more resilient than the original CSS class.
  Consider adding `data-testid="submit-resolution"` to the component for future stability.

**Auto-merge scheduled:** If no objection, this PR will auto-merge in 24 hours.
  To cancel: add label `no-auto-merge` or close the PR.
```

For scenario-level changes, the AI review notes the business impact and explicitly states no auto-merge will occur.

### Confidence Score — Defined

The AI reviewer's confidence score is a weighted composite, not an arbitrary number:

| Weight | Factor | How Measured |
|---|---|---|
| 40% | Semantic locator equivalence | Does the new element have the same ARIA role + accessible name as the old one? |
| 30% | Post-patch execution outcome | Does the test pass when run against the live dev environment with the patched locator? |
| 30% | Blast radius classification | Locator-only change = 1.0 · Step logic change = 0.0 · Mixed = 0.5 |

**Threshold:** ≥ 90% composite score required for auto-merge eligibility. All scores are logged in `.ai-sdlc/locator-heal-log.json` with element fingerprints for audit and trend analysis.

### Drift Corroboration — Healing Must Never Mask a Defect

A high confidence score proves the healer *found a substitute element* — not that the UI change was *intentional*. If a developer accidentally breaks a button's accessible name, a naive healer patches the test to match the broken UI and the suite goes green. Two additional gates prevent this:

1. **Drift-event corroboration (required for auto-merge).** Auto-merge eligibility requires a matching `action_renamed` (or component-rename) event in the latest breadcrumb diff — source-side evidence that the change was deliberate. A locator failure with **no** corresponding drift event means the DOM changed in a way the source scan cannot explain: the healer opens a *failure report*, not a patch, and the test stays red. Accessible-name changes without drift events are additionally flagged for accessibility review, because a changed accessible name is a real user-facing regression for screen-reader users.
2. **Intent replay triage (agent-browser).** Before proposing any patch, the healer replays the failing step's *intent* — the Gherkin text is already a natural-language goal — via `agent-browser -q chat "<gherkin step text>"` against the same environment. If the agent achieves the intent, the failure is a script/locator problem → heal candidate. If the agent also fails, the behavior itself is likely broken → file a defect Jira, never heal. The replay transcript and `agent-browser screenshot --annotate` output are attached to whichever artifact results (heal PR or defect ticket). See Section 19.

### Circuit Breaker

If a single locator (identified by its `page + locator_id` key) is healed **3 or more times within a 30-day rolling window**, `locator_healer.py` stops auto-patching that locator and instead:
1. Opens a Jira escalation ticket referencing all 3 heal events and linking to the heal log
2. Tags the affected test `@locator-unstable` so it runs in the quarantine suite (non-blocking)
3. Notifies the SDET via the existing email report

Repeated healing at the same site is a signal that the component itself is unstable or uses an anti-pattern for locating — both require human judgment, not another automated patch.

### Legitimate Coverage Reduction

The "coverage never regresses" gate blocks MRs that legitimately remove a feature and its tests. This workflow handles planned coverage reduction without bypassing governance:

1. The PR deleting the feature includes a `.ai-sdlc/coverage-reduction-justification.yaml` file (generated via `python qa-toolkit/agents/coverage_audit.py --justify`)
2. The `qa:coverage-gate` job detects this file and switches from **BLOCK** to **WARN** for this MR only
3. The file requires: `reason` (one of: `feature_removed` | `scope_reduced` | `test_consolidation`), `affected_journeys[]`, `approved_by` (SDET GitLab username), `ticket` (Jira link)
4. After merge, the coverage baseline recalculates from the new journey count — the 50% floor applies to the new total, not the historical total
5. The justification file is committed permanently and logged in the audit trail

### Regulated Environment Compliance

For environments subject to SOX, PCI-DSS, or HIPAA change management policies:

- Set `QA_AUTOHEALER_AUTOMERGE=false` at the **repo level** (not the job level — the shared template enforces this). All autonomous PRs require explicit SDET approval.
- The 24-hour auto-merge timer is automatically suppressed during declared GitLab deploy freezes (`$CI_DEPLOY_FREEZE` variable). No configuration needed — the healer checks this variable before scheduling auto-merge.
- All autonomous agent actions (PR creation, locator heal, flakiness tag, Jira ticket) are logged to a tamper-evident audit table in `platform/qa-toolkit` with actor, timestamp, confidence score, and outcome. This log satisfies change management audit requirements for locator-level changes.

### Flakiness Management

A test is quarantined when it fails intermittently in 3 or more pipeline runs within a rolling 14-day window. **Retried-then-passed counts as an intermittent failure**: the MR jobs use `retry: max: 1`, which makes the *pipeline* green on a retry pass — without this rule, the retry policy would hide exactly the flakes the quarantine agent exists to catch. The signal source is the Allure retry status per scenario, not the pipeline result. The flakiness quarantine agent:

1. Tags the test `@flaky` in the feature file (commits directly to a branch, opens PR)
2. Creates a Jira ticket with: test name, failure history, last 3 error messages, link to Allure reports
3. The test continues to run in the `@flaky` quarantine suite (separate job, non-blocking)
4. **Exit condition (both required):** `flakiness_quarantine.py` monitors the quarantine suite run history. The `@flaky` tag is removed only when: (a) the test passes on **5 consecutive runs** in the quarantine job — not 5 total, consecutive — AND (b) the Jira ticket is in `Done` or `Resolved` status, confirmed via Jira REST API. If either condition is unmet, the tag stays. When both are met, the agent opens a PR removing `@flaky` — this PR still requires SDET approval since the fix should be understood before the test re-enters the blocking suite.

---

## 13. Brownfield Onboarding Playbook

This playbook is executed for every existing production application being onboarded. It is designed to be completed in one 6-week sprint by one SDET with support from the app's QA Champion.

### Week 1 — Prerequisites

- [ ] Run `workspace-analysis` on frontend and backend repos. Review `qa-profile.yaml`
- [ ] Confirm OpenAPI spec exists. If not, add springdoc dependency and generate
- [ ] Provision Dynatrace token (or confirm `QA_TELEMETRY_SOURCE=static`)
- [ ] Create `{app-name}-qa` GitLab repo. Bootstrap with npm + Playwright + Cucumber-JS
- [ ] Confirm `platform/qa-ecosystem` is accessible from the app's GitLab group
- [ ] Schedule kickoff with app dev lead and QA Champion

### Week 2 — Breadcrumb Generation & Review

- [ ] Run `breadcrumb_emitter.py` — review output with QA Champion
- [ ] Verify page inventory: run the agent-browser verification crawl per role (Section 19.1); review its diff report with the QA Champion instead of hand-navigating every section
- [ ] Verify role model: confirm with dev lead which roles exist and their permission boundaries
- [ ] Review top 10 journeys by Dynatrace priority — confirm they match real user workflows
- [ ] Commit reviewed breadcrumbs to QA repo

### Week 3 — Test Generation & SDET Review

- [ ] Run `generator_agent.py` — review draft PR
- [ ] Complete TODO implementations in step definitions (implement actual Playwright actions)
- [ ] Agent-browser locator validation pass (Section 19.2) confirms every generated locator resolves and is interactable — fix the flagged ones
- [ ] Import Postman collection, run against dev environment, fix any failures
- [ ] Merge approved artifacts to QA repo `main`
- [ ] Run first smoke suite manually: `npx cucumber-js --tags "@smoke"`

### Week 4 — Pipeline Integration

- [ ] Add one-line include to source repo `.gitlab-ci.yml`
- [ ] Set all required CI/CD variables including `QA_BROWNFIELD_MODE=true`
- [ ] Set up cron schedules (Tue + Thu 06:00)
- [ ] Verify first pipeline run succeeds end-to-end
- [ ] Verify email report delivers correctly

### Weeks 5–6 — Coverage to 50% Floor

- [ ] Coverage audit agent generates gap tickets — SDET prioritizes and backfills
- [ ] AI generates draft feature files for high-priority uncovered journeys — SDET reviews
- [ ] First self-heal event observed and validated
- [ ] Coverage gate confirmed: `API ≥ 50%` and `UI ≥ 50%`
- [ ] Set `QA_BROWNFIELD_MODE=false`
- [ ] Retrospective held with dev team and QA Champion
- [ ] Lessons documented in `platform/qa-toolkit` issues for emitter improvements

### Important Notes

- The source application repo's `main` branch is **never modified** during onboarding except for the one-line CI include and CI/CD variable additions
- All generated test artifacts live in the QA repo, not the source repo
- `QA_BROWNFIELD_MODE=true` is the safety valve — it prevents hard gates from blocking the team while coverage is being established. It must be set to `false` before the onboarding is considered complete
- If Dynatrace data is unavailable for the pilot period, use `static` mode. The journeys will still be generated but prioritization will be based on route depth and component naming heuristics

---

## 14. KPIs & Success Metrics

All metrics are captured automatically from pipeline data and surfaced in:

- Allure reports (per-run)
- Email reports (per regression run — Tue + Thu)
- Monthly ecosystem health dashboard (executive-level)

### Per-Repo Metrics

| Metric | Description | Measurement | Target |
|---|---|---|---|
| API Coverage % | Endpoints with at least one automated test | `covered / total` from coverage-manifest.json | ≥ 50% floor, trending to 100% |
| UI Coverage % | User journeys with at least one automated scenario | `covered journeys / total journeys` | ≥ 50% floor, trending to 100% |
| Coverage Delta (Δ) | Week-over-week coverage change | Computed per regression run | Always ≥ 0 (never regresses) |
| Pass Rate | % of tests passing in latest run | `passed / total` (excluding quarantined) | ≥ 95% |
| MR Feedback Latency | Time from code push to test verdict on the MR | Pipeline duration for MR run | < 15 minutes |
| Flakiness Index | % of tests tagged @flaky | `flaky / total` | < 2% (enforced — see note) |
| Pipeline Duration — MR | Total time for feature-scoped MR run | CI duration log | < 15 minutes |
| Pipeline Duration — Regression | Total time for full regression run | CI duration log | < 25 minutes |

> **Quarantine cannot launder the pass rate.** Because Pass Rate excludes quarantined tests, an unbounded quarantine would let the suite look healthy while rotting. The Flakiness Index is therefore *enforced*, not aspirational: when `flaky / total` exceeds 2%, the quarantine agent stops adding tests (new flakes fail the pipeline instead) until the backlog is burned down. Quarantined count is always displayed next to Pass Rate in every report.
>
> *(The former "MTTD" metric was renamed — pipeline duration measures feedback latency, not defect detection time. True detection time for escaped defects is attributed under the portfolio Defect Escape Rate.)*

### Portfolio Metrics (Executive Dashboard)

| Metric | Description | Target |
|---|---|---|
| Repos in Ecosystem | Count of repos with `QA_ECOSYSTEM_ENABLED=true` and coverage ≥ 50% | +2 per sprint |
| Defect Escape Rate | % of production defects not caught by automation | < 5% by month 12 |
| Automation ROI | Hours of manual testing saved × $120/hour | Positive by month 4 |
| Self-Heal Events | Count of locator patches per month (shows AI is working) | Trending — no target |
| Tests Auto-Generated | Count of test artifacts created by AI agents vs by hand | Trending toward 80% AI-generated |

### ROI Calculation Model

```
Manual regression hours per sprint:          ~40 hours
Fully-loaded hourly rate (SDET):             $120/hour
Monthly manual testing cost:                 $9,600
Annual manual testing cost:                  $115,200

Ecosystem investment (one-time setup):       ~$60,000 (SDET time + tooling)
Ongoing cost (maintenance + scaling):        ~$2,000/month
  ├─ Azure OpenAI (with prompt caching):     ~$300–600/month per active repo wave (estimate — unvalidated, see §21.5)
  ├─ Runner compute (Playwright + agents):   ~$400/month
  └─ SDET review time (heal/gen PRs):        remainder, amortized

Break-even point:                            Month 6
Year 1 net savings:                          ~$55,000 per repo in ecosystem
Year 2+ net savings per repo:                ~$115,000/year
```

---

## 15. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| OpenAPI specs are missing or inaccurate for many repos | High | High | Make spec generation a required first step. Provide springdoc setup guide. Block pipeline until resolved. |
| Dynatrace data is unavailable for some applications | Medium | Medium | `static` fallback mode built-in. Priority heuristics from component naming are good enough for initial coverage. |
| Generated breadcrumbs have significant inaccuracies | Medium | High | SDET review gate before any test generation runs. Corrections feed back into emitter improvements. |
| Developer resistance to writing `.feature` files as DoD | High | Medium | Make it easy — AI drafts the file, dev just reviews. Provide 10-minute workshop. The pipeline only blocks if the file is missing for new user-facing features. |
| GitLab runner capacity insufficient for scale | Medium | Medium | DevOps monitors runner utilization. Scale ahead of each onboarding wave. Playwright's speed means fewer runners needed than Selenium. |
| Self-healing creates incorrect patches or masks a real UI regression | Medium | High | 90% confidence threshold + **drift-event corroboration** (no source-side rename event = no patch, test stays red). Agent-browser intent replay triages locator-vs-defect before any patch (§12, §19.3). 24-hour review window. SDET always has veto. Blast radius limited to locator-level changes only. |
| AI-generated scenarios miss business logic nuances | Medium | Medium | SDET review is mandatory for all generated feature files before merge. AI is a first draft, not a final product. |
| Contractor turnover erodes breadcrumb accuracy | Medium | High | Breadcrumbs are auto-regenerated on every significant source change. Human review is a checkpoint, not the primary maintenance mechanism. |
| Coverage gate blocks legitimate MRs during ramp-up | High | Medium | `QA_BROWNFIELD_MODE=true` during onboarding sprint. Gate only activates after SDET confirms 50% floor is achievable. |
| Ecosystem template changes break downstream repos | Low | High | Semantic versioning on `qa-ecosystem.gitlab-ci.yml`. Repos pin to a version tag, not `main`. Changes announced 2 weeks in advance via GitLab release notes. |
| Pact consumer contracts generated without provider verification inflate API coverage | High | Medium | `coverage-manifest.json` tracks `consumer-only: true` separately. Consumer-only endpoints are excluded from the 50% coverage gate. Provider job config is auto-generated and included in the QA onboarding PR for the backend team. |
| Auto-merged healer PRs violate SOX / PCI-DSS change management policy | Medium | High | `QA_AUTOHEALER_AUTOMERGE=false` disables all auto-merge. Required for regulated repos. Full audit log of all autonomous actions stored in `platform/qa-toolkit`. |
| OpenAPI specs are syntactically valid but semantically poor | High | Medium | `qa:openapi-check` enforces annotation quality bar (typed DTOs, `@Operation` annotations) before onboarding. Poor specs produce WARNING + mandatory Jira item before generation proceeds. |
| AI confidence scores are not independently validated after deployment | Medium | Medium | Confidence formula is documented (Section 12). False-positive rate reviewed monthly by QA Architect via `locator-heal-log.json` trend analysis. Threshold can be raised per-repo via `QA_HEAL_CONFIDENCE_THRESHOLD` CI variable. |
| Automated Jira ticket creation without triage owner creates noise and resentment | High | Medium | Coverage gap tickets are filed against the app team's board with a designated `QA-Champion` assignee set at onboarding time. Tickets include generated feature file stubs so the work is bounded. Weekly creation volume is capped at 5 tickets per repo — larger gaps are batched into one planning ticket. |
| MR gate tests an environment that does not contain the MR's code | High | High | `QA_TARGET_MODE` is mandatory (§11). `review` mode deploys a review app per MR and the gate blocks; `dev-canary` mode demotes the UI run to informational and relies on post-merge auto-revert. The template rejects a blocking UI job against shared dev. |
| Shared dev environment state collisions across parallel pipelines | High | Medium | Rule 7: synthetic-only data, `qa-{CI_PIPELINE_ID}-` entity namespacing, nightly cleanup TTL. Role accounts are per-role, not per-runner — runners never mutate shared fixtures. |
| Prompt injection via source comments, page content, or Jira text steers agents that hold GitLab write tokens | Medium | High | Generation/healer agents run with no tool access during LLM calls; outputs are schema-validated before any git or API action. Agent-browser jobs run fenced with `--allowed-domains` and `--action-policy`. The AI reviewer is never the sole gate on AI-generated output. |
| Azure OpenAI outage blocks all merges via `qa:scope-detect` | Medium | High | Blocking-path agents fail open to `@smoke` within a 30s timeout + 1 retry, with a DEGRADED MODE warning (§11). Non-blocking agents fail closed and retry next run. Gateway distributes rate-limit budget fairly across repos so one repo can't starve others. |
| Agent-browser verification jobs are slow, token-expensive, and nondeterministic | Medium | Low | Agent-browser lanes are cron/async only — never on the blocking MR path (§19). Deterministic Playwright remains the test of record; agents verify, heal, triage, and discover. |
| Enterprise CMS UI semantics resist agent perception (iframes, div-soup, generated IDs) | High | Medium | Perception failures are filed as locator debt + a11y defects (§19.6, §20.5); discoverer falls back to DOM-level interaction and flags the element; testability fixes feed the app team's DoD. |
| Autonomous discovery mutates workflow state in financial apps | High | High | Lanes A/B run only in Rule 7 synthetic environments with seeded cases; `--action-policy` denies money-moving/final-submit categories during exploration — permitted solely in QA-approved Lane A journeys (§20.5). |
| Discovered-journey churn destabilizes the coverage denominator | Medium | Medium | Raw discovery output never enters the denominator directly: journeys are reconciled, reviewed, and only `discovered_by: both` (or SDET-approved) entries count (§20.2). Undemonstrated entries are excluded until proven. |

---

## 16. Definition of Done — Per Repo

A repo is considered fully onboarded into the QA Evergreen Ecosystem when **all** of the following are true:

- [ ] `workspace-analysis` skill has been run and `qa-profile.yaml` is committed
- [ ] `qa-breadcrumbs.yaml` is committed to the QA repo, reviewed by SDET, and passing schema validation
- [ ] QA repo (`{app}-qa`) is created with Playwright + Cucumber-JS bootstrap
- [ ] First test generation run completed — feature files, POM classes, and step definitions committed
- [ ] `platform/qa-ecosystem` include is active in source repo `.gitlab-ci.yml`
- [ ] All required CI/CD variables are set
- [ ] Cron schedules for Tuesday and Thursday regression are active
- [ ] Email report is delivering successfully to the distribution list
- [ ] `QA_BROWNFIELD_MODE=false` — full enforcement active (breadcrumb freshness gate is live)
- [ ] API coverage ≥ 50% confirmed in coverage-manifest.json
- [ ] UI coverage ≥ 50% confirmed in Allure report
- [ ] At least one self-healing locator event has been observed and validated
- [ ] Coverage gate is blocking pipeline (tested with a deliberate coverage regression)
- [ ] QA Champion on the app team has completed onboarding workshop
- [ ] Retrospective held — lessons documented in `platform/qa-toolkit` issues
- [ ] Next repo candidate has been nominated

---

## 17. Tooling & Infrastructure

### Language Stack Decision

| Layer | Language | Key Libraries | Rationale |
|---|---|---|---|
| Step Definitions | TypeScript | `@cucumber/cucumber`, `ts-node` | Existing team codebase. Strong typing catches POM errors at compile time. |
| POM Classes | TypeScript | `@playwright/test`, Locator API | Playwright is TypeScript-native. Semantic locators are more resilient than XPath. |
| API Test Clients | TypeScript | `axios`, `zod`, `faker-js` | Typed requests + schema validation in one ecosystem. |
| AI Agents | Python 3.12 | `openai[azure]`, `gitpython`, `bs4`, `jinja2` | Best AI/ML library ecosystem. All agent work is Python. Azure OpenAI via the gateway. |
| Reporting / Email | Python 3.12 | `jinja2`, `smtplib`, `allure-python` | 20-line email sender with HTML template. Simple and debuggable. |
| CI Glue | bash (minimal) | `echo`, `cp`, `if/else` only | Max 10 lines per job. Anything complex goes into Python. |
| ❌ Java / Selenium | Not used | — | Team is JS/TS. Playwright supersedes Selenium for new UI tests. |

### Docker Images

| Purpose | Image | Notes |
|---|---|---|
| UI + API tests | `mcr.microsoft.com/playwright:v1.44.0-jammy` | Node 20 + Chromium + Firefox + WebKit pre-installed. **Versioning strategy:** the GitLab team owns this pin. A quarterly scheduled job in `platform/qa-ecosystem` runs the latest Playwright image against the pilot QA repo's `@smoke` suite. If green, the template is updated and released as a minor version with a 2-week announcement window. Repos pinning to a version tag (recommended) are not auto-updated. |
| AI agents + reporting | `python:3.12-slim` | Minimal image. Dependencies installed per job from `requirements.txt` |
| Allure report generation | `python:3.12-slim` with `allure-commandline` | Installed via npm in the job |
| Agent-browser verification | Playwright image + `npm install -g agent-browser` + `agent-browser install` | Cron lanes only (Section 19). Pinned version in the template. Sessions closed in `after_script` via `agent-browser close --all`. |

### Model Selection (Azure OpenAI)

The platform uses **Azure-hosted OpenAI (GPT-5.2)** — see §21.2 for the provider decision and what it changes. The architecture is provider-agnostic: every agent calls the model through the `platform/qa-toolkit` gateway, never an SDK directly, so the deployment behind each tier can change without touching agent code. Different tasks have different cost/quality tradeoffs; using one tier for everything inflates cost.

| Agent | Task | Model tier | Rationale |
|---|---|---|---|
| `journey_deriver.py` | Propose candidate journeys from page graph | `QA_MODEL_REASONING` (GPT-5.2) | Complex reasoning over large context — quality matters |
| `generator_agent.py` | Generate Gherkin + TypeScript + POM | `QA_MODEL_REASONING` (GPT-5.2) | Code generation requires strong reasoning |
| `trace_compiler.py` | Compile recorded trace → `.feature`/steps/POM | `QA_MODEL_REASONING` (GPT-5.2) | Naming + assertion quality is the keystone (§20.3) |
| `locator_healer.py` | Classify locator equivalence + confidence score | `QA_MODEL_FAST` (smaller Azure deployment) | High-frequency, simple classification — cost-sensitive |
| `report_narrator.py` | Narrate test failures in plain English | `QA_MODEL_FAST` | Fast generation from structured input |
| `coverage_audit.py` | Identify gaps + generate feature stubs | `QA_MODEL_FAST` | Template-driven generation |
| AI code reviewer | Review generated PRs for correctness | `QA_MODEL_REASONING` (GPT-5.2) | Review quality directly affects auto-merge safety |

The two tiers are environment variables in `platform/qa-toolkit` (`QA_MODEL_REASONING`, `QA_MODEL_FAST`) bound to Azure OpenAI deployment names, and can be overridden per-repo. **Prompt caching** is used for agents that repeatedly read the same breadcrumb file, OpenAPI spec, or template files — via Azure OpenAI's prompt-caching support. The 60–70% cost-reduction figure is an estimate to be validated in the POC (§21.5), not a measured number.

**Data governance — substantially simplified by the Azure decision (§21.2):** Because Azure OpenAI runs inside the company's own Azure tenancy, the "proprietary source / DOM / screenshots leave the building" concern the security review led with is largely resolved — traffic stays in-tenant. Three controls make it defensible at a Fortune 100 financial:

1. Confirm the Azure OpenAI resource is configured for **no data retention** (abuse-monitoring opt-out where eligible) and that the tenancy/network boundary keeps all calls inside the company's Azure environment. This replaces the signed-zero-retention-with-an-external-vendor requirement.
2. Rule 7 guarantees test environments contain **synthetic data only**, so DOM snapshots and screenshots are free of PII/cardholder data by construction. A DLP scan on outbound payloads (and on the test environment) enforces this rather than assuming it.
3. The gateway in `platform/qa-toolkit` logs every outbound payload type (source / DOM / screenshot) per repo for audit.

### External Integrations

| Service | Purpose | Access Method |
|---|---|---|
| Dynatrace | Session-based journey prioritization | REST API — `DYNATRACE_TOKEN` CI variable |
| Splunk | Log-based failure correlation in AI reports | REST API — `SPLUNK_TOKEN` CI variable |
| Azure OpenAI (GPT-5.2) | AI agent intelligence (journey derivation, generation, review, narration) | Azure AD / managed identity to the gateway; endpoint in `QA_AZURE_OPENAI_ENDPOINT`, any key in Azure Key Vault — never a group-level GitLab variable |
| Jira | Auto-filing tickets for coverage gaps and flaky tests | REST API — `JIRA_TOKEN` CI variable |
| GitLab API | Opening draft PRs from autonomous agents | `CI_JOB_TOKEN` (built-in, scoped via CI job token allowlist — source repos must explicitly allow `platform/qa-toolkit` in their token allowlist settings) |
| Pact Broker | Publishing consumer contracts + provider verification results | `PACT_BROKER_TOKEN` CI variable. Broker hosted at `platform/pact-broker` (internal GitLab Pages). Access restricted to `platform/` group members only — consumer contracts describe API topology and must not be publicly accessible. |

---

## 18. Open Questions & Decisions Log

### Resolved Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Test framework language | TypeScript + Cucumber-JS | Existing team codebase. No migration cost. |
| UI test framework | Playwright (not Selenium) | Auto-wait, network interception, TypeScript-native, actively maintained. |
| API test library | axios + zod | Typed requests + schema validation in one ecosystem. |
| AI agent language | Python 3.12 | Best AI/ML library ecosystem for agent work. |
| CI/CD platform | GitLab (shared include template) | Dedicated GitLab team available. Two-approval MR rule already enforced. |
| Self-healing trust level | AI fixes → AI reviews → Human approves | Locator fixes auto-merge after 24h at ≥ 90% confidence. Scenario changes always require SDET. |
| Brownfield strategy | Feature-flagged parallel branch + separate QA repo | Zero disruption to source repo `main`. `QA_BROWNFIELD_MODE` controls gate enforcement. |
| Journey prioritization | Dynatrace-first, static-analysis fallback | Real telemetry beats assumption. Fallback ensures brownfield repos with no telemetry still work. |
| Coverage floor | 50% API + 50% UI | Proven PoC threshold. Undeniable enough to drive adoption. Path to 100% is automated. |
| Browser verification tooling | `agent-browser` CLI, cron lanes only | Accessibility-tree perception matches the semantic locator strategy. Built-in guardrails (`--allowed-domains`, `--action-policy`, auth vault). Deterministic Playwright remains the test of record (Section 19). |
| MR gate environment | `QA_TARGET_MODE` review / dev-canary | A merge gate must test the MR's build. Review apps where possible; informational canary + post-merge revert where not (Section 11). |
| Journey authoring | Demonstrated, never imagined | `journey_deriver.py` demoted to exploration-goal proposer; journeys enter breadcrumbs only with a recorded agent-browser trace; trace compiler freezes demonstrations into deterministic artifacts (Section 20). |
| CMS app inventory source | `cms_config` parser strategy | For CMS-built workflow apps the config export is the spec — more authoritative than parsing generated frontend code (Section 20.4). |
| LLM provider | Provider-agnostic; in-tenant; bake-off pending | Two candidates — Azure OpenAI GPT-5.2 (Azure tenant) and Claude Sonnet 4.6 on Bedrock (AWS account). Both keep traffic in-cloud, so governance is equivalent; decided by POC false-positive rate + cost, not benchmarks (Section 21.2). |
| Coverage denominator | Demonstrated journeys only | Single authoritative definition in §9; undemonstrated entries excluded until proven achievable (Section 20.2). Resolves the §9/§20 ambiguity the review board flagged. |

### Open Questions

| Question | Owner | Target Date |
|---|---|---|
| What Azure OpenAI quota (TPM/RPM) is provisioned for the volume of generation calls expected during a large brownfield scan? | QA Architect | Before Pilot Week 7 |
| Should the Postman collection be committed to the QA repo or the source repo? | QA Architect + Dev Lead | Before Pilot Week 7 |
| What Jira project should coverage gap tickets be filed against — the app's board or a central QA board? | QA Architect + PM | Before Pilot Week 9 |
| Should `qa-breadcrumbs.yaml` live in the source repo or the QA repo for greenfield projects? | QA Architect | Before Phase 3 |
| How do we handle applications with multiple frontends (e.g., admin portal + customer portal in same repo)? | QA Architect | Before Phase 3 |
| What is the process for deprecating the ecosystem from a repo that is being sunset? | GitLab Team | Before Phase 4 |

---

## 19. Agent Browser Integration

The toolkit uses the **`agent-browser` CLI** (`npm install -g agent-browser`, then `agent-browser install` for browser binaries) — a daemon-based browser automation CLI built for AI agents. Its primitives map directly onto the ecosystem's weakest points: `snapshot` returns the accessibility tree with stable `@ref` handles (the same semantic layer our locator rules are built on), `diff snapshot` compares page states, `find role|label|testid` resolves semantic locators, `chat` executes a natural-language goal, and the auth vault + `--allowed-domains` / `--action-policy` flags provide the guardrails a financial application requires.

**Operating boundary (non-negotiable):** agent-browser lanes run in **cron/async jobs only — never on the blocking MR path**. Agent runs are slower, token-metered, and nondeterministic; deterministic Playwright remains the test of record. Agents *verify, heal, triage, and discover* — they do not replace tests. All `chat`-mode model calls route through the same `platform/qa-toolkit` gateway as every other agent (Section 17 data governance applies).

### 19.1 Breadcrumb Verification Crawl (Layer 2)

Static parsing cannot see feature-flagged routes, role-conditional rendering, or runtime-composed UI — which is why the playbook previously required an SDET to hand-navigate every section. A weekly `breadcrumb_verifier.py` job replaces that manual checkpoint:

```bash
# One isolated session per role; credentials from the auth vault (Rule 7)
agent-browser --session verify-admin --allowed-domains "{app}.dev.example.com" \
  auth login {app}-admin
agent-browser --session verify-admin open "$QA_BASE_URL/disputes"
agent-browser --session verify-admin snapshot -i --json > snap.admin.disputes.json
```

The verifier walks every route in `qa-breadcrumbs.yaml` per role, captures interactive-element snapshots, and diffs them against the breadcrumb page/action inventory. Mismatches become new drift event types consumed by Layer 5: `page_unreachable`, `action_not_rendered`, `undocumented_action`, `role_access_mismatch` (a role reached a page its breadcrumb entry says it can't — an empirical RBAC check no static scan provides).

### 19.2 Generated Locator Validation (Layer 3)

Before the generator opens its draft PR, a validation pass executes every generated POM locator against the live dev environment — `find role button --name "Submit Resolution"`, `is visible <sel>`, `get count <sel>` — and attaches `screenshot --annotate` output as review evidence. The former "manual spot-check" becomes a full check; SDETs review only flagged failures.

### 19.3 Healing Evidence & Intent Replay (Layer 5)

- **Perceive:** the healer's "DOM scan" is `snapshot` (accessibility roles + names — exactly what confidence factor 1 measures) plus `diff snapshot` to isolate what changed.
- **Triage:** before proposing any patch, replay the failing step's intent — Gherkin text is already a natural-language goal: `agent-browser -q chat "Submit the dispute resolution form"`. Agent succeeds → locator/script problem → heal candidate. Agent fails → likely real defect → Jira, never heal. (Full rules in Section 12, Drift Corroboration.)
- **Verify:** the post-patch execution check (confidence factor 2) runs in an isolated `--session heal-verify`, with `console`, `errors`, and `network har` output attached to the heal PR for audit.

### 19.4 Exploratory Gap Discovery (Coverage Audit)

Dynatrace shows what users *do*; goal-driven exploration finds what users *could hit*. A monthly job gives the agent role-scoped exploration goals ("attempt every visible action on the disputes module as `user`; report errors and dead ends"), capturing `console`/`errors` and HAR along the way. Findings feed `coverage_audit.py` as journey candidates and bug reports — error states and abandoned-flow paths that neither static analysis nor telemetry surfaces.

### 19.5 Guardrails

| Control | Mechanism |
|---|---|
| Navigation fence | `--allowed-domains "{app}.dev.example.com"` — the agent cannot leave the environment under test |
| Action policy | `--action-policy qa-action-policy.json` + `--confirm-actions` — destructive/payment-shaped submissions are deny-by-default; agents have no `confirm` authority |
| Credentials | Auth vault profiles per role (Rule 7), AES-256-GCM state encryption (`AGENT_BROWSER_ENCRYPTION_KEY`), auto-expiry (`AGENT_BROWSER_STATE_EXPIRE_DAYS=7`) |
| Session isolation | `--session` per role per job; `agent-browser close --all` in every `after_script` |
| Environment | dev/staging with synthetic data only (Rule 7) — never production |
| Prompt injection | Page content is untrusted input to the agent; the agent's write surface is limited to artifacts (snapshots, reports) that downstream agents schema-validate — page text can never trigger a git or GitLab API action directly |
| Evidence hygiene | HAR files scrubbed of `Authorization` headers before upload as artifacts |

### 19.6 The Accessibility Dividend

Agent-browser perceives through the accessibility tree — the same reason the POM rules prefer `getByRole`/`getByLabel`. UI that agents can verify is UI that screen readers can operate. The verification crawl therefore doubles as a lightweight a11y audit: elements reachable only by CSS class (no role, no accessible name) are reported as both *locator debt* and *accessibility debt* in the weekly report.

---

## 20. Journey Discovery & Trace Compilation

Validated hands-on (June 2026) with `agent-browser` v0.27: accessibility-tree snapshots are breadcrumb-grade inventories obtainable with zero source access, and a recorded action trace compiles directly into a feature file, step definitions, and POM locators. This section makes discovery a first-class producer of breadcrumb journeys — replacing the weakest link in the original design: `journey_deriver.py` *imagining* step sequences from a static page graph, with SDETs told to "correct any illogical sequences."

**Principle: journeys are demonstrated, not imagined.** A journey enters `qa-breadcrumbs.yaml` only with a recorded execution trace proving it is achievable. Undemonstrated entries are allowed but flagged `undemonstrated: true` and excluded from the coverage denominator until demonstrated — the gate math only counts journeys that are provably executable.

### 20.1 Three Intake Lanes

| Lane | Producer | How |
|---|---|---|
| **A — QA-authored** | QA Champion / SDET | Plain-English scenarios ("as an analyst, resolve an open dispute") submitted via `journey-requests.yaml`. The discovery agent executes the intent stepwise via agent-browser; every action is recorded: a11y role + accessible name, URL, API calls observed (HAR), screenshot. |
| **B — Autonomous exploration** | `journey_discoverer.py` | Per-role systematic crawl (the agent-browser `dogfood` pattern: orient → visit each nav section → exercise interactive elements → evidence per finding). Builds a navigation state graph; candidate journeys are coherent paths through it. `journey_deriver.py` proposes exploration goals for this lane — it no longer authors journeys. |
| **C — Static skeleton** | `breadcrumb_emitter.py` (existing) | Routes, roles, API surface from source + OpenAPI + CMS config. This is the *checklist that bounds exploration* — it knows what should exist, including pages unreachable without data preconditions — and the only lane that works pre-deployment. |

### 20.2 Reconciliation & Provenance

Every breadcrumb page, action, and journey carries provenance:

```yaml
journeys:
  - id: analyst-dispute-resolution
    role: super-user
    discovered_by: both          # static | dynamic | both
    evidence:
      trace: .ai-sdlc/traces/analyst-dispute-resolution.json
      har: .ai-sdlc/traces/analyst-dispute-resolution.har
      screenshot: .ai-sdlc/traces/analyst-dispute-resolution.png
```

- `both` — solid: counts toward the coverage denominator.
- `static` only — suspicious: dead code, or reachable only with data preconditions. Flagged for seeded-case discovery (20.5).
- `dynamic` only — suspicious: undocumented or feature-flag-only surface. Flagged for source/config review.
- The `api_calls[]` field — the hardest thing to infer statically — is recorded **empirically** from the HAR during demonstration.
- **Retirement symmetry:** *agent-cannot-reach* retires nothing until the static/config scan confirms `page_removed` — the mirror of healing's drift corroboration (Section 12).

### 20.3 Trace Compiler

`trace_compiler.py` converts a recorded trace into deterministic artifacts:

- **`.feature`** — the model names the Given/When/Then from the scenario intent + trace. Content nondeterminism is abstracted: assert the *intent* ("a result list is shown"), never the rendered *instance* (personalized rows, dynamic counts).
- **`steps.ts` + POM** — semantic locators lifted directly from the snapshot's role + accessible name (`getByRole('button', { name: 'Submit Resolution' })`). Never raw `@e`-refs — refs are session-scoped noise that change between snapshots (validated empirically).
- **Breadcrumb journey entry** with the evidence block from 20.2.

**Discovery is expensive once; replay is deterministic Playwright forever.** The agent re-enters only for healing triage (19.3) and the weekly verification crawl (19.1) — never as the test runner of record.

### 20.4 CMS-Configured Applications — Config Is the Spec

Most target applications (money movement, fraud, disputes, chargebacks) are CMS-style workflow apps: screens, fields, role assignments, and workflow states live in exportable *configuration*, not hand-written React routes. For these:

- The emitter's fourth parser strategy, `cms_config`, reads the configuration export as the authoritative page/action/role inventory — more accurate and cheaper than parsing generated frontend code.
- Lane B keeps the same job: per-role crawls verify the *configured* surface actually renders and operates, and discover what config can't express — conditional rendering, integration glue, broken states.
- This is the favorable case for discovery: *work queue → case detail → action → confirmation* compiles naturally to Gherkin, and repeated grid/filter/detail components mean discovered POM patterns generalize across modules instead of being one-offs.

### 20.5 Domain Rules for Financial Workflow Apps

1. **Seeded synthetic cases.** Discovery *acts* — "resolve dispute" is reachable only if an OPEN dispute exists. Lane A/B runs seed the queue first via the Rule 7 data factories.
2. **Money-moving actions are deny-by-default during exploration.** The `--action-policy` fence blocks final-submit / funds-movement categories in autonomous exploration; they are permitted only in QA-approved Lane A scripted journeys against synthetic data.
3. **Per-role crawls are empirical RBAC verification.** Analyst vs supervisor vs admin approval boundaries *are the product* in this domain. `role_access_mismatch` drift events from the crawl are triaged as potential security findings, not test debt.
4. **Expect perception friction.** Enterprise CMS UIs (iframes, div-soup buttons, generated IDs) resist a11y-tree perception. Validated live: a demo app's menu was invisible to the accessibility tree and swallowed physical clicks until a DOM-level fallback. Every such element is filed as both *locator debt* and an *accessibility defect* (19.6) — fixing it improves users and automation simultaneously.

### 20.6 Empirical Validation Notes (June 2026)

- **Demo workflow app (saucedemo.com):** login happy path, menu→logout multi-step journey, and negative login executed via snapshot-refs. Error states surface in the a11y tree as assertable nodes. Found a real testability/a11y defect (hidden menu, swallowed clicks) within minutes of starting.
- **Public production sites (logged-out, read-only):** a complete search→product-detail journey was discovered and is directly compilable to `.feature` + POM with zero source access. Refs proved session-unstable (same element, different ref per snapshot) — confirming compile-to-role+name. Personalized content confirmed intent-vs-instance abstraction.
- **Session isolation is non-optional:** the daemon's `default` session is machine-shared; a concurrent user collided with a test mid-run. One `--session` per job, `agent-browser close --all` in `after_script` (19.5).

---

## 21. Reality Check, Provider Decision & Pre-Implementation Backlog

This section exists because Sections 1–20 read like a description of a system that runs. It does not run. This section states what is true today, records the LLM provider decision, fixes two internal contradictions a hostile review board caught, triages that review into a backlog tagged by *when each item actually bites*, and defines the proof of concept that is the real next step.

### 21.1 Current State vs Target State

As of this version, the following do **not** exist:

- **No CI/CD.** There is no `.gitlab-ci.yml` in any repo, no shared `platform/qa-ecosystem` template, no pipeline jobs, no coverage gate, no cron schedules, no nightly cleanup. The entire **Enforcement layer (Layer 4)** and the **autonomous cron lanes (Layer 5)** are unbuilt.
- **No AI agents.** `breadcrumb_emitter.py`, `journey_deriver.py`, `journey_discoverer.py`, `generator_agent.py`, `trace_compiler.py`, `cms_config_parser.py`, `locator_healer.py`, and every other agent in the §5 toolkit tree is unwritten.
- **No artifacts.** No QA repos, no `qa-breadcrumbs.yaml`, no generated feature files, POM classes, coverage manifests, or audit tables.

**Consequence for the review board's findings:** most operational blockers (shared-env cleanup races, runner capacity, `ref:main` blast radius, cron contention, template versioning) describe failure modes of a *running platform*. They are real, but they are **not yet risks** — each becomes one only when the layer that needs it is built. The backlog in 21.4 tags every item with the milestone at which it must be resolved, so the POC is not blocked by Phase-4 concerns.

### 21.2 Provider Decision — Provider-Agnostic, In-Tenant, Bake-Off Pending

The architecture is **provider-agnostic**: all agents call the model through the `platform/qa-toolkit` gateway, never a vendor SDK directly, so the deployment behind each tier can change without touching agent code. Earlier Claude model names in this document were illustrative. **Two candidate providers are in evaluation, both in-tenant:**

| | Azure OpenAI (GPT-5.2) | Claude Sonnet 4.6 (AWS Bedrock) |
|---|---|---|
| Hosting | Company's **Azure tenant** | Company's **AWS account** |
| Auth | Azure AD / managed identity; key in Azure Key Vault | AWS IAM / SigV4 |
| SDK behind gateway | `openai[azure]` | `anthropic[bedrock]` (`anthropic.claude-sonnet-4-6`) |
| Pricing | confirm with Azure rep | $3 / $15 per 1M in/out |
| Structured/strict output | JSON-schema structured outputs | `output_config.format` + `strict` tool use |
| Batch (bulk brownfield gen) | Azure batch deployments | Batch API, –50%, ≤24h |
| Data egress | stays in Azure tenant | stays in AWS account |

**Governance is a wash** — both keep all traffic (source, DOM, screenshots) inside a company cloud boundary, which is what neutralizes the AppSec review's lead blocker. So this is a **quality-and-cost decision, not a security one**, and it is settled by the POC, not by benchmarks:

- **Determinism is not a selection criterion.** No frontier LLM is deterministic, even at temperature 0 (vendor guidance is explicit on this). Production consistency comes from the trace compiler freezing a demonstration into deterministic Playwright (§20.3) and from **schema-constrained generation** (structured outputs / strict tool use — both providers support it), *not* from the model choice. Pick on generation quality, not reproducibility.
- **Decide on measured numbers** from the POC (§21.5): the **AI-draft false-positive rate** on this org's CMS traces, and **cost per generated artifact**. Whichever provider produces fewer plausible-but-wrong `.feature`/POM outputs on the real screens wins.
- **It is a tiered workload.** `QA_MODEL_REASONING` (generation, trace compiler, AI reviewer) is low-volume and quality-critical — pay for the best. `QA_MODEL_FAST` (healer classification, narration, stubs) dominates call volume — optimize cost there with batch + prompt caching. The gateway can even route the two tiers to different providers if the bake-off favors a split.

The provider-specific instances in §17 (Azure key/SDK/caching) describe the Azure option; substitute the Bedrock column above if that provider wins the bake-off.

### 21.3 Two Corrected Contradictions

The review board found two genuine internal contradictions (now fixed in-text, not just logged):

1. **Coverage denominator (§9 vs §20).** §9 said `÷ total journeys in breadcrumbs`; §20 said undemonstrated journeys are excluded. Since the gate is a merge blocker, an ambiguous denominator is gameable. **Resolved:** §9 is now the single authoritative definition — the denominator is *demonstrated journeys only*; §20 conforms.
2. **`ref: main` vs version pinning (§6 sample vs §15 risk row).** The adoption sample showed `ref: main` while the risk register said "pin to a version tag." **Resolved:** the §6 sample now pins to `v1.0.0` with an inline warning. (Moot until CI exists, but corrected so the doc can't mislead.)

### 21.4 Hostile Review Board — Triaged Backlog

A four-lens internal review (GitLab platform engineer, AppSec/Security architect, skeptical app dev lead, SRE/DevOps) was run against this plan. **No reviewer found an architectural flaw.** The convergent finding was *claims-as-controls*: the document repeatedly says a mechanism "handles it automatically" or "is enforced" where the enforcement is not yet built. Items below are tagged **[POC]** (decide/measure during the proof of concept), **[PILOT]** (before the first real repo's gate goes live), **[SCALE]** (before onboarding >3 repos).

| When | Item | Owner | Source |
|---|---|---|---|
| **[POC]** | Build the model gateway as a real service (Azure-auth broker, per-repo quota, payload-type audit log) — it is the lynchpin of secret-isolation, cost caps, and rate-limiting | SDET + Platform | GitLab, Security, SRE |
| **[POC]** | Measure the three unvalidated numbers: AI-draft false-positive rate, healer false-positive rate, scope-detect p99 latency (see 21.5) | QA Architect | App-lead, SRE |
| **[POC]** | Pin the coverage denominator definition in `coverage_gate.py` to demonstrated-only and assert it in a test | SDET | App-lead, SRE |
| **[POC]** | Define the trace compiler's **assertion bar**: every compiled scenario must assert ≥1 state change the action *caused* (from the post-action snapshot diff), not just "intent reached" — else compiled tests are coverage theater | QA Architect | (new, from oracle-quality gap) |
| **[POC]** | Confirm Azure OpenAI resource no-retention setting + tenancy/network boundary; DLP scan on outbound payloads | Security | Security |
| **[PILOT]** | Agent-browser hygiene: assert `--session` on every call; prove `close --all` runs on job timeout/cancel; orphan-daemon reaper on the runner | SRE | SRE |
| **[PILOT]** | `QA_TARGET_MODE` enforcement: template validates that `review` mode has a real `deploy:review` job and that `dev-canary` demotes the UI job to `allow_failure`; **assign review-app ownership to the app team** | GitLab + App-lead | GitLab, App-lead |
| **[PILOT]** | Cross-repo coverage-gate SLA: written backfill SLA from QA, or `QA_BROWNFIELD_MODE` stays until QA explicitly removes it; new-journey grace window so adding a page can't block the author's merge | QA Architect + App-lead | App-lead |
| **[PILOT]** | Healer: drift-corroboration must be *fresh* (breadcrumb freshness passed in the same run); failure reports get an owner + SLA; auto-merge stays **off** until false-positive rate is measured | SDET | Security, SRE |
| **[PILOT]** | OpenAPI prerequisite is real app-team work — negotiate scope (top-N endpoints) and a reciprocal deliverable (client SDK from the spec); don't hand it over unbudgeted | QA Architect + App-lead | App-lead |
| **[PILOT]** | Tamper-evident audit log: real implementation (append-only + signed/hashed, or external immutable store), not a table by assertion; SOX/PCI control mapping; named accountable human for any auto-merge | Security | Security, SRE |
| **[PILOT]** | Prompt-injection defense beyond schema validation: untrusted inputs (source comments, Jira, DOM) are fenced; agents hold no write tokens during model calls; AI reviewer is never the sole gate | Security | Security |
| **[SCALE]** | Shared-env contention: concurrency semaphore + per-prefix entity cap + seeded-case quota + "dev is wedged" runbook and on-call; not TTL-hope | SRE | SRE |
| **[SCALE]** | Template versioning: canary rollout to 1–2 repos, tested rollback, template↔toolkit version matrix, registry of which repo pins which version | GitLab + SRE | GitLab, SRE |
| **[SCALE]** | Flakiness quarantine self-cleaning: per-repo flakiness cap, stale-flake escalation SLA, a deprecate-unfixable-test path so quarantine can't grow unbounded | SDET + SRE | SRE |
| **[SCALE]** | Ecosystem health: SLOs, dashboard, on-call rotation, incident severities, and a "tests are all red" runbook — distinct from the §14 QA KPIs | SRE | SRE |
| **[SCALE]** | Per-repo Azure OpenAI spend cap with alerting + kill switch for a runaway agent loop | Platform | GitLab, SRE |

### 21.5 The Proof of Concept (the actual next step)

Do **not** start Phase 1 wholesale. Build a two-week **steel thread** that exercises the riskiest links for a fraction of the Phase-1 cost — and, critically, works in today's reality (no CI, no agents). Scope:

- **One app** (a real CMS workflow app if a synthetic-data env is available; otherwise a workflow-shaped practice app — saucedemo / OrangeHRM — to de-risk the mechanics first).
- **Agents run locally / manually**, invoked from a developer machine or a single ad-hoc job — no shared template, no cron, no enforcement. The point is to prove the *loop*, not the platform.
- **Build the minimum chain, behind the gateway from day one:** `cms_config`-or-static breadcrumb skeleton → one QA-authored journey demonstrated via agent-browser → a prototype `trace_compiler.py` that emits one `.feature` + steps + POM with the 21.4 assertion bar → run it as deterministic Playwright → produce a one-app coverage manifest.
- **Keep autonomy off:** no auto-merge, no auto-filed Jira, agent-browser in a fenced `--session` against synthetic data only.
- **Measure and report** the three numbers that every reviewer said are unvalidated:
  1. **AI-draft false-positive rate** — of N generated/compiled feature files, what fraction needed substantial human rework? (Tests the "AI drafts it, you just review" claim.)
  2. **Healer false-positive rate** — seed M broken locators; how many heals were correct vs plausible-but-wrong? (Tests the 90% confidence threshold.)
  3. **Scope-detect / model p99 latency** against the real deployment(s) on representative inputs. (Tests the <15-min and outage-fallback claims.)

  Run metrics 1–2 against **both** candidate providers (§21.2) on the same traces — this *is* the provider bake-off; the winner is whichever gives the lower false-positive rate at acceptable cost, not whichever benchmarks higher.

If the steel thread works, Phase 1 builds out from something proven and the 21.4 backlog becomes the gating checklist for each layer. If it doesn't, you learned it in two weeks instead of ten — and the numbers recalibrate every estimate in this document that is currently a hypothesis.

---

*Document maintained by QA Architect · Feedback via `platform/qa-toolkit` GitLab issues*
*Version 1.4 · June 2026 — §21.2 reframed as a provider-agnostic, in-tenant bake-off (Azure OpenAI GPT-5.2 vs Claude Sonnet 4.6 on Bedrock) decided by POC false-positive rate + cost, with the determinism caveat made explicit; HTML explainers synced to vendor-neutral "model gateway" language. (v1.3 added Section 21: current-state honesty, two corrected contradictions, the four-lens hostile-review backlog, and the POC definition.)*
