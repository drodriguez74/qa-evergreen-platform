# FundFlow — Angular front-end (steel thread)

Angular implementation of the FundFlow steel thread. It exposes the **exact same
accessibility surface** (roles + accessible names + routes) as the sibling React
app, per `../../shared/a11y-contract.md`, so one Playwright test of record passes
against both apps unchanged.

## Stack

- Angular 19 (standalone components), TypeScript, Angular Router, HttpClient
- Dev server on port **4200** (`ng serve` default)
- API base URL is a single constant: `src/app/api.config.ts` → `http://localhost:4000`

## Run

```bash
# 1. Start the mock API (from steel-thread/api)
cd ../../api && npm install && node server.js   # listens on :4000

# 2. Start this app
npm install
npm start            # ng serve on http://localhost:4200
```

Production build:

```bash
npm run build        # ng build -> dist/fundflow-angular
```

## Test accounts

| Username     | Password   | Role       | Approval limit |
| ------------ | ---------- | ---------- | -------------- |
| `analyst`    | `demo1234` | analyst    | $10,000        |
| `supervisor` | `demo1234` | supervisor | none           |

## Routes / screens

`/login` → `/dashboard` → `/transfer` → `/transfer/review` →
`/transfer/receipt/:id`. The route guard redirects to `/login` when there is no
token.

## Accessibility contract notes

- All form controls use `<label for>` + `<input>`/`<select>`; headings use exact
  text and level; tables get their accessible name from `aria-label`; buttons'
  text matches the contract character-for-character.
- Validation and server-error messages render in `role="alert"` with the exact
  contract strings.
- Currency uses `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`
  → `$50,000.00`, `Amount: $2,500.00`.

### Deliberate accessibility defect (required)

The dashboard menu toggle (`src/app/dashboard.component.ts`) is a non-semantic
`<div class="menu-toggle">☰</div>` with only a click handler — **no `role`, no
`aria-label`, no keyboard handler**. It is invisible to `getByRole` and to
keyboard users, reproducing the swallowed-click / invisible-control defect the
verification crawl is meant to flag. Everything else stays semantic.

### Recent Activity data source

The OpenAPI spec defines no endpoint for `recentActivity`. To avoid hand-coding
it in component logic, the dashboard loads it from `src/assets/fixtures.json`
(a copy of `shared/fixtures.json`, served as a static asset). Accounts, payees,
transfers and receipts are fetched live from the API.
