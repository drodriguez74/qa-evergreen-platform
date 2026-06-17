import { Page, expect } from '@playwright/test';

export class DashboardPage {
  constructor(private page: Page) {}

  async openPIM(): Promise<void> {
    await this.page.getByRole('link', { name: "PIM" }).click();
    // POST-NAVIGATION HYDRATION WAIT: wait for Employee Information heading to confirm navigation
    await expect(this.page.getByRole('heading', { name: 'Employee Information' })).toBeVisible({ timeout: 15000 });
  }

  async assertEmployeeInformationVisible(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Employee Information' })).toBeVisible({ timeout: 15000 });
  }
}
