# QA Evergreen — Steel Thread

A two-week, one-journey proof of concept for the [QA Evergreen](../qa-evergreen-implementation-plan.md) strategy (§21.5). It builds the minimum chain end-to-end and measures the three numbers every reviewer flagged as unvalidated.

## The experiment

**Discover a journey once; get a framework-agnostic test of record.** A money-movement app is built twice — once in React, once in Angular — exposing an **identical accessibility contract** ([`shared/a11y-contract.md`](shared/a11y-contract.md)). agent-browser discovers the journey on the React build; the trace compiler freezes it into a deterministic Playwright spec; that *same* spec runs against **both** builds. If both pass, semantic (role + accessible-name) locators are framework-independent — which is the core argument for discovery over per-framework static parsers.

## Layout

```
steel-thread/
├── shared/
│   ├── a11y-contract.md   ← authoritative: routes, roles, exact accessible names
│   ├── openapi.yaml       ← the mock API contract
│   └── fixtures.json      ← synthetic seed data (Rule 7)
├── api/                   ← Node+Express mock API (port 4000), implements openapi.yaml
├── apps/
│   ├── react/             ← Vite+React+TS (port 5173)
│   └── angular/           ← Angular standalone+TS (port 4200)
└── thread/
    ├── assertion-bar.md   ← compiled scenarios must assert a *caused* state change
    ├── discover.mjs       ← agent-browser journey capture (+ HAR for api_calls)
    ├── trace_compiler.mjs ← trace → .feature + steps + POM (Sonnet, claude-sonnet-4-6)
    ├── generated/         ← compiler output (the test of record)
    └── playwright.config  ← runs the generated spec against react AND angular
```

## Boundaries (thread 1)

- **Provider:** Claude Sonnet (`claude-sonnet-4-6`) via a personal API key, **only** in `thread/trace_compiler.mjs`. Synthetic data only — the key never sees company source or real data.
- **No autonomy:** no auto-merge, no auto-filed tickets. agent-browser is fenced to localhost.
- **Not a coverage number:** the output is the three POC metrics + a yes/no on "compiled trace runs as deterministic Playwright on both frameworks."

## Run order

1. `api/` → `npm install && npm start` (serves :4000)
2. `apps/react/` → `npm install && npm run dev` (:5173)
3. `apps/angular/` → `npm install && npm start` (:4200)
4. `thread/` → discover → compile → run against both. See `thread/run.md`.
