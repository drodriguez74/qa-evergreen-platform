import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/login.page';
import { DashboardPage } from './pages/dashboard.page';
import { TransferPage } from './pages/transfer.page';
import { TransferReviewPage } from './pages/transfer-review.page';
import { TransferReceiptPage } from './pages/transfer-receipt.page';

test.describe('Analyst initiates and confirms a transfer (happy path)', () => {
  test('analyst logs in, submits a transfer, and lands on a populated receipt', async ({ page }) => {
    // ── Step 1: Sign in ──────────────────────────────────────────────────────
    const loginPage = new LoginPage(page);
    await page.goto('/login');
    await loginPage.assertHeading();
    await loginPage.fillUsername('analyst');
    await loginPage.fillPassword('demo1234');
    await loginPage.clickSignIn();

    // ── Step 2: Dashboard ────────────────────────────────────────────────────
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.assertHeading();
    await dashboardPage.clickInitiateTransfer();

    // ── Step 3: Transfer form ────────────────────────────────────────────────
    const transferPage = new TransferPage(page);
    await transferPage.assertHeading();
    await transferPage.selectFromAccount('Operating');
    await transferPage.selectPayee('Acme Supplies');
    await transferPage.fillAmount('2500');
    await transferPage.fillMemo('Q2 invoice');
    await transferPage.clickContinueToReview();

    // ── Step 4: Review & Confirm ─────────────────────────────────────────────
    const reviewPage = new TransferReviewPage(page);
    await reviewPage.assertHeading();
    await reviewPage.assertAmountText('Amount: $2,500.00');
    await reviewPage.clickConfirmTransfer();

    // ── Step 5: Receipt — mandatory state-change assertions ──────────────────
    const receiptPage = new TransferReceiptPage(page);

    // Assert the heading that the "Confirm transfer" click CAUSED to appear
    await receiptPage.assertHeading();

    // Assert a populated Transaction ID (label + non-empty value) — the core assertion bar
    await receiptPage.assertTransactionId();

    // Assert the back-to-dashboard button is present as well
    await receiptPage.assertBackToDashboardVisible();
  });
});
