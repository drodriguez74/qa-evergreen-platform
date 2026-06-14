# FundFlow — React front-end (steel thread)

Vite + React + TypeScript implementation of the FundFlow money-movement app.
It implements the shared accessibility contract
(`../../shared/a11y-contract.md`) character-for-character so a single
Playwright test of record passes against both this app and the Angular app.

## Prerequisites

The mock API must be running on **http://localhost:4000** (see
`../../api/`). Start it first:

```bash
cd ../../api
npm install && npm start
```

The API base URL lives in one constant: `src/api.ts` (`API_BASE_URL`).

## Run

```bash
npm install
npm run dev      # dev server on http://localhost:5173  (Vite default, strict)
```

Other scripts:

```bash
npm run build    # type-check (tsc -b) + production build
npm run preview  # serve the production build
npm run typecheck
```

## Screens / routes

| Route                     | Screen            |
| ------------------------- | ----------------- |
| `/login`                  | Sign in           |
| `/dashboard`              | Dashboard         |
| `/transfer`               | Initiate Transfer |
| `/transfer/review`        | Review & Confirm  |
| `/transfer/receipt/:id`   | Receipt           |

Any route other than `/login` redirects to `/login` when there is no token.

## Test accounts

| Username     | Password   | Role       | Approval limit |
| ------------ | ---------- | ---------- | -------------- |
| `analyst`    | `demo1234` | analyst    | $10,000        |
| `supervisor` | `demo1234` | supervisor | none           |

## Deliberate accessibility defect (required by the contract)

The dashboard menu toggle (`☰`) is rendered as a non-semantic `<div>` with an
`onClick` only — no `role`, no `aria-label`, no keyboard handler — so it is
intentionally invisible to `getByRole`. This reproduces the swallowed-click /
invisible-control defect the verification crawl is meant to flag. Everything
else on every screen is fully semantic.

## Notes

- "Recent Activity" has no endpoint in `openapi.yaml`; the table is fetched
  from `/api/activity` and degrades to an empty (but present) table if that
  path is absent, so the contract's accessible-name surface is unaffected.
