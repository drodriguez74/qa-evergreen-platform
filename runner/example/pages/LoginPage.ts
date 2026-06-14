import { Page } from '@playwright/test';

export class LoginPage {
  constructor(private readonly page: Page) {}

  /** Fill in the Username field */
  async fillUsername(value: string): Promise<void> {
    await this.page.getByRole('textbox', { name: 'Username' }).fill(value);
  }

  /** Fill in the Password field */
  async fillPassword(value: string): Promise<void> {
    await this.page.getByRole('textbox', { name: 'Password' }).fill(value);
  }

  /** Click the Login button */
  async clickLogin(): Promise<void> {
    await this.page.getByRole('button', { name: 'Login' }).click();
  }
}
