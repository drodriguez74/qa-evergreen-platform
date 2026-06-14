import { type Page, type Locator, expect } from '@playwright/test';

export class TransferReviewPage {
  private readonly heading: Locator;
  private readonly confirmButton: Locator;
  private readonly backButton: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Review & Confirm', level: 1 });
    this.confirmButton = page.getByRole('button', { name: 'Confirm transfer' });
    this.backButton = page.getByRole('button', { name: 'Back' });
  }

  async assertHeading(): Promise<void> {
    await expect(this.heading).toBeVisible();
  }

  async assertAmountText(text: string): Promise<void> {
    await expect(this.page.getByText(text, { exact: true })).toBeVisible();
  }

  async clickConfirmTransfer(): Promise<void> {
    await this.confirmButton.click();
  }

  async clickBack(): Promise<void> {
    await this.backButton.click();
  }
}
