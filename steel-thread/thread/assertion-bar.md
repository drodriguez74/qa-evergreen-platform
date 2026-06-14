# The Assertion Bar

**The rule.** Every compiled UI scenario MUST assert at least one **state change that the
action *caused*** — a difference observable in the post-action accessibility-tree snapshot
that was not present before the action. Asserting "a route loaded" or "an intent was reached"
is **not** sufficient. A test that only checks navigation is coverage theater: the route can
change while the money-moving action silently failed.

> Source: plan §21.4 (assertion-bar backlog item) and §20.3 (Trace Compiler). The contract's
> "Caused-state-change assertion" section is the canonical example.

## Why "route loaded" is not enough

A SPA can push `/transfer/receipt/:id` into the URL bar from client-side routing even when the
`POST /api/transfers` failed, returned a 422, or rendered an empty shell. The thing that proves
the **Confirm transfer** click did its job is the *content the server's success caused to appear*:
the receipt heading and a populated transaction id. That is what we assert.

## How the bar is satisfied

1. Discovery captures a **pre-action** snapshot and a **post-action** snapshot for the gating step.
2. The trace records the diff: nodes (role + accessible name) present *after* the action that were
   absent *before* it.
3. The compiler turns at least one of those diffed nodes into an explicit Playwright assertion in
   the spec, located by **role + accessible name only** (never CSS / testid / `@ref`).
4. Content nondeterminism is abstracted: assert the *intent* of the new node (a transaction id is
   present and non-empty), not a specific rendered *instance* (not a hard-coded id value).

## The concrete example (from `shared/a11y-contract.md`)

Journey `analyst-transfer-happy-path`, the gating step:

- **Action:** click the button with accessible name **`Confirm transfer`** on `/transfer/review`
  (the money gate — `POST /api/transfers`).
- **Caused state change** (what the post-action snapshot adds, what the spec MUST assert):
  - a **heading**, level 1, with accessible name **`Transfer Complete`**, AND
  - a **text** node matching **`Transaction ID:`** followed by a **non-empty** id.

```ts
// In analyst-transfer.spec.ts, after clicking "Confirm transfer":
await expect(
  page.getByRole('heading', { level: 1, name: 'Transfer Complete' })
).toBeVisible();                                    // the heading the click caused

await expect(
  page.getByText(/Transaction ID:\s*\S+/)
).toBeVisible();                                    // a *populated* transaction id, not just the label
```

Asserting only `await expect(page).toHaveURL(/\/transfer\/receipt\//)` would **fail** the bar:
it proves the route, not that the transfer completed.

## Checklist the compiler enforces

- [ ] At least one assertion per scenario targets a node **introduced by** the action (snapshot diff).
- [ ] That node is located by **role + accessible name** (`getByRole` / `getByLabel` / `getByText`).
- [ ] Dynamic content is asserted by **shape** (non-empty / matches a pattern), not by a frozen value.
- [ ] Navigation-only assertions (`toHaveURL`) may appear *in addition to*, never *instead of*, the
      caused-state-change assertion.
