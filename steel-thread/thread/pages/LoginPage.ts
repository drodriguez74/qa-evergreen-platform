import { Page, expect } from '@playwright/test';

export class LoginPage {
  constructor(private page: Page) {}

  async navigate(baseURL: string): Promise<void> {
    await this.page.goto(new URL('/web/index.php/auth/login', baseURL).toString());
  }

  async login(username: string, password: string): Promise<void> {
    await this.page.getByRole('textbox', { name: "Username" }).fill(username);
    await this.page.getByRole('textbox', { name: "Password" }).fill(password);
    await this.page.getByRole('button', { name: "Login" }).click();
    // POST-LOGIN HYDRATION WAIT: wait for Dashboard heading to confirm navigation
    await expect(this.page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 });
  }

  async assertDashboardVisible(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 });
  }
}
