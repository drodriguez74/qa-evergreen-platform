# Decision: discovery-first vs breadcrumb-first

The plan (§1–20) is **breadcrumb-first**: statically analyze source (React routes, Spring roles,
OpenAPI) → emit `qa-breadcrumbs.yaml` (pages/actions/journeys/api surface/priority) → generate tests
from it. What we actually built is **discovery-first**: drive the live app with agent-browser →
capture a trace (real a11y tree + caused-state-change) → generate a deterministic test from the trace.
This is the biggest open architectural call for Bar C. This doc records the analysis + recommendation
so the office decision is fast.

## Why discovery-first emerged (and largely wins)
- **Ground truth.** The trace records what the app *actually* exposes (roles, names, the real
  state change), not what source analysis *predicts*. The locator ladder (Tiers 1–4) is built on this.
- **Framework/stack-agnostic.** Works on React+Angular behind one a11y contract, and on live external
  apps (OrangeHRM, SauceDemo) with NO source access and NO contract.
- **CMS reality.** The plan itself (§2 Rule 2, §20.4) notes most targets are CMS-configured apps where
  screens/roles live in config, not hand-written code — static React/Spring parsers don't apply.
- **Less to build/maintain.** No per-framework route/role parsers; one discovery path.

## What breadcrumb-first still offers (don't discard)
- **Coverage denominator.** "What SHOULD exist" — static surface (all routes, all OpenAPI endpoints,
  all roles) is the denominator for true coverage %. Discovery only sees what a journey walked. We
  already use OpenAPI statically for API coverage; the same idea applies to UI surface.
- **Priority signal.** Dynatrace-by-usage prioritization keys off the page/endpoint inventory.
- **Drift detection.** Diffing a stable inventory across versions is how you detect added/removed
  pages/endpoints/roles (the Layer-5 drift events).

## Recommendation: discovery-first, with a thin static "surface map"
Keep discovery as the **generator of tests** (it is the source of truth for locators + assertions).
Add a lightweight **surface map** (NOT the full breadcrumb/parser stack) purely as the **coverage
denominator + drift baseline**, fed by the cheapest available source per app:
- **API:** the OpenAPI spec (already used). ✔ done.
- **UI:** the set of routes/screens — ideally from the CMS **config export** (plan §20.4) when the app
  is CMS-built, else a shallow route list. This is the denominator for "journeys covered ÷ screens".
- **Roles:** the role list from config/`@PreAuthorize` only where trivially available; otherwise the
  roles the discovery journeys actually exercised.

Then:
- **Coverage** = discovered/demonstrated journeys ÷ surface-map screens (UI) and zod-tested ÷ OpenAPI
  endpoints (API — already implemented).
- **Drift** = diff today's surface map vs last (added/removed screen/endpoint/role → Layer-5 actions).
- **Skip** the heavy `react_route_parser` / `spring_role_extractor` / jinja template stack unless a
  specific app needs them — discovery + the surface map cover the goal at a fraction of the build.

## Net
Discovery-first is the spine; "breadcrumbs" shrink to a thin, config-or-OpenAPI-sourced **surface map**
for coverage/drift. Revisit per app at office time: if a target is pure hand-written React/Spring with
great a11y, a static parser may add value; for CMS apps (the majority), it won't. Related plan section:
§20 (Journey Discovery & Trace Compilation) already half-adopts this.
