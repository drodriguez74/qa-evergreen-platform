import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { World } from '../support/world.js';
import { LoginPage } from '../pages/LoginPage.js';

Given('I am on the OrangeHRM login page', async function (this: World) {
  await this.page.goto(new URL('/web/index.php/auth/login', this.baseURL).toString());
});

When('I sign in as Admin with password {string}', async function (this: World, password: string) {
  const loginPage = new LoginPage(this.page);
  await loginPage.login('Admin', password);
});

Then('I should see the Dashboard', async function (this: World) {
  const loginPage = new LoginPage(this.page);
  await loginPage.assertDashboardVisible();
});
