import { type Page, type Locator, expect } from '@playwright/test';

export class TransferReceiptPage {
  private readonly heading: Locator;
  private readonly backToDashboardButton: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Transfer Complete', level: 1 });
    this.backToDashboardButton = page.getByRole('button', { name: 'Back to dashboard' });
  }

  async assertHeading(): Promise<void> {
    await expect(this.heading).toBeVisible();
  }

  /**
   * Mandatory assertion-bar check:
   * Verifies that a "Transaction ID:" label is present on the page
   * followed by a non-empty value — confirming the state change
   * caused by clicking "Confirm transfer".
   */
  async assertTransactionId(): Promise<void> {
    await expect(
      this.page.getByText(/Transaction ID:\s*\S+/)
    ).toBeVisible();
  }

  async assertBackToDashboardVisible(): Promise<void> {
    await expect(this.backToDashboardButton).toBeVisible();
  }

  async clickBackToDashboard(): Promise<void> {
    await this.backToDashboardButton.click();
  }
}
