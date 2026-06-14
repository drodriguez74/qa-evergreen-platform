import { type Page, type Locator, expect } from '@playwright/test';

export class LoginPage {
  private readonly heading: Locator;
  private readonly usernameInput: Locator;
  private readonly passwordInput: Locator;
  private readonly signInButton: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Sign in to FundFlow', level: 1 });
    this.usernameInput = page.getByRole('textbox', { name: 'Username' });
    this.passwordInput = page.getByRole('textbox', { name: 'Password' });
    this.signInButton = page.getByRole('button', { name: 'Sign in' });
  }

  async assertHeading(): Promise<void> {
    await expect(this.heading).toBeVisible();
  }

  async fillUsername(value: string): Promise<void> {
    await this.usernameInput.fill(value);
  }

  async fillPassword(value: string): Promise<void> {
    await this.passwordInput.fill(value);
  }

  async clickSignIn(): Promise<void> {
    await this.signInButton.click();
  }
}
