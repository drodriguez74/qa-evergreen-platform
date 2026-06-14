import { type Page, type Locator, expect } from '@playwright/test';

export class DashboardPage {
  private readonly heading: Locator;
  private readonly initiateTransferButton: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Dashboard', level: 1 });
    this.initiateTransferButton = page.getByRole('button', { name: 'Initiate Transfer' });
  }

  async assertHeading(): Promise<void> {
    await expect(this.heading).toBeVisible();
  }

  async clickInitiateTransfer(): Promise<void> {
    await this.initiateTransferButton.click();
  }
}
