# Roadmap to "Complete" (the QA Evergreen Ecosystem — plan §1–20)

"Complete" = **Bar C**: the full ecosystem in [`implementation-plan.md`](implementation-plan.md), not
just the validated POC. That is a multi-phase program (the plan scoped ~36 weeks). We have a **proven
vertical slice** through all five layers; what remains is **breadth, enforcement, autonomy, and scale**
— much of which can only be built in the office against real infra (GitLab, Dynatrace, Pact Broker,
test accounts). This doc is the gap map + sequencing.

## Status by layer

| Plan layer | Built | Remaining for Bar C |
|---|---|---|
| **1 Detection** | live-crawl `profile_init` (discovery-based) | static source detection (`qa-profile.yaml`), parsers: `react_route_parser`, `cms_config_parser`, `spring_role_extractor`, `openapi_mapper` — **or** a decision that discovery supersedes them (see Reconciliation) |
| **2 Breadcrumb** | `journey_discoverer` → trace (demonstration-based) | `qa-breadcrumbs.yaml` model + schema + freshness/drift events; `dynatrace_prioritizer` (priority by real usage); api-surface mapping |
| **3 Generation** | `test_generator` (trace → feature/POM/spec), locator ladder T1–4 | breadcrumb-driven generation; **Postman** collections; **Pact** consumer contracts + provider verify; jinja-style templates (optional — model path works) |
| **4 Enforcement** | metrics scripts (coverage manifest, evidence) | **none of the CI layer**: `qa-ecosystem.gitlab-ci.yml` shared template, coverage **gate** (block merge), `scope_detector` (diff→tags), `check_openapi`/`check_breadcrumbs`, email/report narration |
| **5 Autonomy** | `locator_healer`, `a11y_remediator` (propose-only) | scheduled regression (cron), **auto-heal/auto-PR** once FP-rate trusted, `drift_detector`, `coverage_audit`→tickets, `flakiness_quarantine`, `report_narrator` |
| **Gateway (lynchpin)** | built (provider-agnostic, credential seam, multimodal, quota/cost/audit/latency) | PILOT-grade auth (Azure AD/Key Vault live), per-repo spend cap + kill switch, tamper-evident audit |

## Phases (dependency order)

**Phase 0 — Validate on the real app (critical path; gates everything).**
Onboard the real office app → passing deterministic test + metrics + a11y-debt; bring the audit back
and reconcile. Until this holds, don't pour effort into the layers below — the audit reorders them.

**Phase 1 — Reconcile design + finish Generation breadth.** *(mostly buildable here)*
- **Reconciliation decision:** the plan is breadcrumb-first (static analysis → YAML → generate); we built
  discovery-first (crawl → trace → generate). Decide how much static breadcrumb/parser layer to build vs
  let discovery+the trace be the source of truth. (Plan §20 already half-acknowledges discovery.)
- Pact consumer contracts + provider `pact:verify` + Pact Broker; Postman collections; api-coverage with
  zod schema validation (closes the current "0/N strict API coverage" gap).
- Test accounts + synthetic-data factories per role (Rule 7) — **needs the real env**.

**Phase 2 — Enforcement / Layer 4.** *(needs office GitLab)*
- `qa-ecosystem.gitlab-ci.yml` shared template (one-line include), pinned-version rollout.
- Coverage **gate** that blocks merge below threshold; `scope_detector` (git-diff → TEST_TAGS) for
  selective runs (+ measure its <15-min/p99 claim — the deferred metric #3 half).
- `check_openapi` / `check_breadcrumbs` freshness jobs; email/PR report narration.

**Phase 3 — Autonomy / Layer 5.** *(office; gated on measured FP rates)*
- Scheduled regression (cron); `report_narrator` failure summaries.
- Turn `locator_healer` + `a11y_remediator` from propose-only into **draft PRs** (auto-PR), with
  auto-merge OFF until the real-app false-positive rate is trusted.
- `drift_detector` (breadcrumb/trace diff → action), `coverage_audit` → tickets, `flakiness_quarantine`.

**Phase 4 — Scale + hardening.** *(office)*
- Multi-repo rollout (3 → 10+), the §21.4 **PILOT/SCALE backlog** (shared-env contention, secrets at
  group scope + rotation, prompt-injection fencing, tamper-evident audit, SLOs/dashboard/on-call,
  per-repo spend cap + kill switch).
- Provider bake-off (Azure GPT vs Sonnet) once an in-tenant cred exists.
- Plan §16 "Definition of Done — per repo" becomes the acceptance checklist per onboarded repo.

## Cross-cutting decisions still open
- **Python port:** plan specs Python agents; we're Node. Decide port vs keep (gateway HTTP boundary
  makes agents language-agnostic, so it can be incremental — see [[language-python-preferred-node-ok]]).
- **Provider:** Sonnet default; bake-off deferred (not a blocker).
- **Discovery vs breadcrumb** (the Phase-1 reconciliation above) — the biggest architectural call.

## Buildable here vs needs the office
- **Here (dev):** Phase 1 generation breadth (Pact/Postman/zod), the reconciliation, a *skeleton*
  CI template, autonomy agents' logic (testable on demo apps).
- **Office only:** real-app validation, the live CI gate (their GitLab), Dynatrace prioritization,
  Pact Broker, test accounts, real auto-PRs against app repos, scale/observability.

**Bottom line:** the path to Bar C runs **through the office**. Next concrete step is Phase 0
(real-app validation); the audit that comes back decides how Phases 1–4 are prioritized.
