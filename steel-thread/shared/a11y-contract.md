# FundFlow — Accessibility Contract (the steel-thread keystone)

**This is the authoritative spec. The React app and the Angular app MUST expose the exact same accessibility surface — same ARIA roles, same accessible names, same routes.** A journey discovered (via agent-browser) on the React build is compiled once into a Playwright test of record; that *same* test must pass against the Angular build with zero changes. That only works if every element below has an identical `role` + accessible name in both frameworks.

The DOM, CSS, class names, and component structure may differ freely between the two apps. The **accessibility tree may not.**

## Rules for both implementations

- Prefer native semantic HTML so locators resolve by **role + accessible name** (`getByRole`, `getByLabel`). Do not rely on `data-testid` or CSS classes for the contract — those are not part of it.
- Every form control has a programmatic label whose text is exactly the **Accessible name** in the tables below (use `<label for>`, `aria-label`, or `aria-labelledby`).
- Buttons' accessible name = their visible text, exactly as written.
- Headings use the exact text and `level` given.
- Error/validation messages render in an element with `role="alert"` and the exact text given.
- Routes use the exact paths given (hash or history routing both fine, as long as the path segment matches).
- Base API URL: `http://localhost:4000`. Dev ports: **React 5173**, **Angular 4200**.

## Roles & test accounts (synthetic — see `fixtures.json`)

| Username | Password | Role | Approval limit |
|---|---|---|---|
| `analyst` | `demo1234` | analyst | $10,000 |
| `supervisor` | `demo1234` | supervisor | none |

## Routes

| Route | Screen |
|---|---|
| `/login` | Sign in |
| `/dashboard` | Dashboard |
| `/transfer` | Initiate Transfer |
| `/transfer/review` | Review & Confirm |
| `/transfer/receipt/:id` | Receipt |

Unauthenticated access to any route except `/login` redirects to `/login`.

---

## Screen 1 — `/login`

| Element | Role | Accessible name | Notes |
|---|---|---|---|
| Page title | heading (level 1) | `Sign in to FundFlow` | |
| Username field | textbox | `Username` | |
| Password field | textbox | `Password` | `type="password"` |
| Submit | button | `Sign in` | POST `/api/login` |
| Error banner | alert | `Invalid username or password` | only on 401 |

On success store the token and role, then navigate to `/dashboard`.

## Screen 2 — `/dashboard`

| Element | Role | Accessible name | Notes |
|---|---|---|---|
| Page title | heading (level 1) | `Dashboard` | |
| Signed-in indicator | text | `Signed in as {displayName}` | e.g. "Signed in as Avery Analyst" |
| Balances section | heading (level 2) | `Account Balances` | |
| Accounts table | table | `Accounts` | one row per account: name + formatted balance (`$50,000.00`) |
| Activity section | heading (level 2) | `Recent Activity` | table `Recent Activity` from fixtures |
| Primary CTA | button (or link) | `Initiate Transfer` | navigates to `/transfer` |
| Sign out | button | `Sign out` | clears token, returns to `/login` |

> **Deliberate accessibility defect (required).** Render the menu toggle as a **non-semantic** element — a `<div>` (or `<span>`) with a click handler, **no `role`, no accessible name, no keyboard handler** — that toggles a small menu. Label it visually only (e.g. a "☰" glyph). This must NOT be reachable by `getByRole`. It reproduces the real swallowed-click/invisible-control defect found on saucedemo and lets the verification crawl flag it as locator + a11y debt (plan §19.6). Everything else on the page stays fully semantic.

## Screen 3 — `/transfer` (Initiate Transfer)

| Element | Role | Accessible name | Notes |
|---|---|---|---|
| Page title | heading (level 1) | `Initiate Transfer` | |
| From account | combobox | `From account` | options = account names from `/api/accounts` |
| Payee | combobox | `Payee` | options = payee names from `/api/payees` |
| Amount | textbox | `Amount` | numeric entry (plain text input is fine) |
| Memo | textbox | `Memo` | optional |
| Continue | button | `Continue to review` | validates, then navigates to `/transfer/review` |

Client-side validation messages, each in `role="alert"` with this exact text:

| Condition | Alert text |
|---|---|
| empty / zero / non-numeric amount | `Enter a valid amount greater than zero` |
| amount > selected account balance | `Amount exceeds available balance` |
| analyst only: amount > $10,000 | `Amount exceeds your approval limit of $10,000` |

A supervisor never sees the approval-limit alert. On valid input, carry the transfer details to the review screen.

## Screen 4 — `/transfer/review` (Review & Confirm)

| Element | Role | Accessible name | Notes |
|---|---|---|---|
| Page title | heading (level 1) | `Review & Confirm` | |
| From summary | text | `From: {account name}` | |
| Payee summary | text | `Payee: {payee name}` | |
| Amount summary | text | `Amount: {formatted}` | e.g. "Amount: $2,500.00" |
| Memo summary | text | `Memo: {memo or "—"}` | |
| Confirm | button | `Confirm transfer` | **the money gate** — POST `/api/transfers` |
| Back | button | `Back` | returns to `/transfer` with values preserved |

On a 201, navigate to `/transfer/receipt/{transactionId}`. On a 422, show the server `message` in a `role="alert"`.

## Screen 5 — `/transfer/receipt/:id` (Receipt)

| Element | Role | Accessible name | Notes |
|---|---|---|---|
| Page title | heading (level 1) | `Transfer Complete` | |
| Transaction id | text | `Transaction ID: {id}` | |
| New balance | text | `New balance: {formatted}` | from receipt `newBalance` |
| Done | button (or link) | `Back to dashboard` | navigates to `/dashboard` |

---

## The reference journey (what discovery will capture)

`analyst-transfer-happy-path`, role `analyst`:

1. `/login` → fill `Username`=`analyst`, `Password`=`demo1234` → click `Sign in`
2. `/dashboard` → assert heading `Dashboard` visible → click `Initiate Transfer`
3. `/transfer` → select `From account`=`Operating`, `Payee`=`Acme Supplies`, fill `Amount`=`2500`, `Memo`=`Q2 invoice` → click `Continue to review`
4. `/transfer/review` → assert `Amount: $2,500.00` → click `Confirm transfer`
5. `/transfer/receipt/:id` → assert heading `Transfer Complete` AND a `Transaction ID:` text is present

**Caused-state-change assertion (the assertion bar):** the receipt's heading + a populated `Transaction ID:` is the state change the `Confirm transfer` click *caused*. The compiled test asserts that — not merely that the receipt route loaded.

Negative journeys available for later: insufficient funds (`Amount`=`999999` from Operating), analyst over limit (`Amount`=`15000`), invalid amount (`Amount`=`abc`).
