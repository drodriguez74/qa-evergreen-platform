import { type Page, type Locator, expect } from '@playwright/test';

export class TransferPage {
  private readonly heading: Locator;
  private readonly fromAccountCombobox: Locator;
  private readonly payeeCombobox: Locator;
  private readonly amountInput: Locator;
  private readonly memoInput: Locator;
  private readonly continueButton: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Initiate Transfer', level: 1 });
    this.fromAccountCombobox = page.getByRole('combobox', { name: 'From account' });
    this.payeeCombobox = page.getByRole('combobox', { name: 'Payee' });
    this.amountInput = page.getByRole('textbox', { name: 'Amount' });
    this.memoInput = page.getByRole('textbox', { name: 'Memo' });
    this.continueButton = page.getByRole('button', { name: 'Continue to review' });
  }

  async assertHeading(): Promise<void> {
    await expect(this.heading).toBeVisible();
  }

  async selectFromAccount(value: string): Promise<void> {
    await this.fromAccountCombobox.selectOption(value);
  }

  async selectPayee(value: string): Promise<void> {
    await this.payeeCombobox.selectOption(value);
  }

  async fillAmount(value: string): Promise<void> {
    await this.amountInput.fill(value);
  }

  async fillMemo(value: string): Promise<void> {
    await this.memoInput.fill(value);
  }

  async clickContinueToReview(): Promise<void> {
    await this.continueButton.click();
  }
}
