/**
 * Negative + RBAC journeys — runs against BOTH the React and Angular builds
 * (the playwright.config `react` / `angular` projects). Self-contained:
 * locators are role + accessible name only, transcribed from
 * shared/a11y-contract.md, so this spec does NOT depend on the
 * compiler-generated page objects (which trace_compiler.mjs overwrites).
 *
 * Proves: client-side validation (invalid amount, insufficient funds), the
 * analyst approval-limit boundary, and the RBAC dividend — the SAME $15,000
 * transfer that an analyst is blocked from is allowed for a supervisor.
 */
import { test, expect, Page } from '@playwright/test';

const API = 'http://localhost:4000';

test.beforeEach(async () => {
  // Reset mock API to fixtures so balances/limits are deterministic per test.
  await fetch(`${API}/api/reset`, { method: 'POST' });
});

async function signIn(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill('demo1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
}

async function openTransferForm(page: Page) {
  await page.getByRole('button', { name: 'Initiate Transfer' }).click();
  await expect(page.getByRole('heading', { name: 'Initiate Transfer', level: 1 })).toBeVisible();
}

async function fillTransfer(
  page: Page,
  { from = 'Operating', payee = 'Acme Supplies', amount = '', memo = 'test' } = {},
) {
  await page.getByLabel('From account').selectOption({ label: from });
  await page.getByLabel('Payee').selectOption({ label: payee });
  await page.getByLabel('Amount').fill(amount);
  await page.getByLabel('Memo').fill(memo);
  await page.getByRole('button', { name: 'Continue to review' }).click();
}

test.describe('Negative validation (analyst)', () => {
  test('invalid amount "abc" → alert, stays on the transfer form', async ({ page }) => {
    await signIn(page, 'analyst');
    await openTransferForm(page);
    await fillTransfer(page, { amount: 'abc' });
    await expect(page.getByRole('alert')).toContainText('Enter a valid amount greater than zero');
    await expect(page).toHaveURL(/\/transfer$/); // did NOT advance to review
  });

  test('amount "0" → invalid-amount alert', async ({ page }) => {
    await signIn(page, 'analyst');
    await openTransferForm(page);
    await fillTransfer(page, { amount: '0' });
    await expect(page.getByRole('alert')).toContainText('Enter a valid amount greater than zero');
    await expect(page).toHaveURL(/\/transfer$/);
  });

  test('insufficient funds (999999 from Operating) → balance alert', async ({ page }) => {
    await signIn(page, 'analyst');
    await openTransferForm(page);
    await fillTransfer(page, { from: 'Operating', amount: '999999' });
    await expect(page.getByRole('alert')).toContainText('Amount exceeds available balance');
    await expect(page).toHaveURL(/\/transfer$/);
  });

  test('analyst over approval limit (15000) → approval-limit alert', async ({ page }) => {
    await signIn(page, 'analyst');
    await openTransferForm(page);
    await fillTransfer(page, { from: 'Operating', amount: '15000' });
    await expect(page.getByRole('alert')).toContainText('Amount exceeds your approval limit of $10,000');
    await expect(page).toHaveURL(/\/transfer$/);
  });
});

test.describe('RBAC boundary', () => {
  test('supervisor CAN transfer 15000 — the same amount that blocks an analyst', async ({ page }) => {
    await signIn(page, 'supervisor');
    await openTransferForm(page);
    await fillTransfer(page, { from: 'Operating', payee: 'Acme Supplies', amount: '15000', memo: 'RBAC check' });

    // No approval-limit alert for a supervisor; the flow advances to review.
    await expect(page.getByRole('heading', { name: 'Review & Confirm', level: 1 })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);

    await page.getByRole('button', { name: 'Confirm transfer' }).click();

    // Caused state change: the receipt with a populated Transaction ID.
    await expect(page.getByRole('heading', { name: 'Transfer Complete', level: 1 })).toBeVisible();
    await expect(page.getByText(/Transaction ID:\s*\S+/)).toBeVisible();
  });
});
