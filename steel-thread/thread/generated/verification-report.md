# FundFlow — Verification Crawl Report

- Generated: 2026-06-12T08:40:13.144Z
- Target: React build (http://localhost:5173)
- Contract: shared/a11y-contract.md
- Driver: agent-browser v0.27 (snapshot -i --json)
- Session: verify-crawl (fenced to localhost)

> Each role signs in through the UI, then the crawl walks the directly-reachable routes, snapshots the interactive accessibility tree, and diffs it against the contract. The `/transfer/review` and `/transfer/receipt/:id` screens require mid-flow state (an in-progress transfer) and are **not** directly addressable by URL, so they are marked **flow-only** and skipped by this crawl.

## Accessibility / locator debt

The following nodes carry a click affordance (`clickable` / `[onclick]` / `cursor:pointer`) yet expose `role="generic"` with **no accessible name**. They are **unreachable by `getByRole` / `getByLabel`** and reproduce the saucedemo swallowed-click / invisible-control defect (plan §19.6).

| Crawl role | Route | ref | node role | accessible name | affordances | likely menu toggle |
|---|---|---|---|---|---|---|
| analyst | /dashboard | e4 | generic | `☰` | clickable, onclick, cursorPointer | **YES — ☰ toggle** |
| supervisor | /dashboard | e4 | generic | `☰` | clickable, onclick, cursorPointer | **YES — ☰ toggle** |

> **Deliberate defect caught.** The dashboard menu toggle (the ☰ glyph) is rendered as a role-less `<div>`/`<span>` with an onclick and no accessible name — exactly the planted locator + a11y debt (plan §19.6). A `getByRole('button', { name: 'Menu' })` locator can never resolve it.

## Role: analyst (Avery Analyst)

- Signed in via UI: yes
- "Signed in as …" indicator present on /dashboard: yes

**Role-access / reachability:**

| Route | Reachable |
|---|---|
| /dashboard | YES |
| /transfer | YES |

### /dashboard — Dashboard

| Contract element (role + accessible name) | Status |
|---|---|
| heading "Dashboard" (level 1) | FOUND |
| heading "Account Balances" (level 2) | FOUND |
| table "Accounts" | FOUND |
| heading "Recent Activity" (level 2) | FOUND |
| table "Recent Activity" | FOUND |
| button "Initiate Transfer" | FOUND |
| button "Sign out" | FOUND |

_No undocumented interactive elements._

### /transfer — Initiate Transfer

| Contract element (role + accessible name) | Status |
|---|---|
| heading "Initiate Transfer" (level 1) | FOUND |
| combobox "From account" | FOUND |
| combobox "Payee" | FOUND |
| textbox "Amount" | FOUND |
| textbox "Memo" | FOUND |
| button "Continue to review" | FOUND |

_No undocumented interactive elements._

**Flow-only routes (skipped — require mid-flow state):**

- /transfer/review — Review & Confirm
- /transfer/receipt/:id — Receipt

## Role: supervisor

- Signed in via UI: yes
- "Signed in as …" indicator present on /dashboard: yes

**Role-access / reachability:**

| Route | Reachable |
|---|---|
| /dashboard | YES |
| /transfer | YES |

### /dashboard — Dashboard

| Contract element (role + accessible name) | Status |
|---|---|
| heading "Dashboard" (level 1) | FOUND |
| heading "Account Balances" (level 2) | FOUND |
| table "Accounts" | FOUND |
| heading "Recent Activity" (level 2) | FOUND |
| table "Recent Activity" | FOUND |
| button "Initiate Transfer" | FOUND |
| button "Sign out" | FOUND |

_No undocumented interactive elements._

### /transfer — Initiate Transfer

| Contract element (role + accessible name) | Status |
|---|---|
| heading "Initiate Transfer" (level 1) | FOUND |
| combobox "From account" | FOUND |
| combobox "Payee" | FOUND |
| textbox "Amount" | FOUND |
| textbox "Memo" | FOUND |
| button "Continue to review" | FOUND |

_No undocumented interactive elements._

**Flow-only routes (skipped — require mid-flow state):**

- /transfer/review — Review & Confirm
- /transfer/receipt/:id — Receipt

## Contract elements unexpectedly MISSING

_None — every contract element on the walked routes was found._

