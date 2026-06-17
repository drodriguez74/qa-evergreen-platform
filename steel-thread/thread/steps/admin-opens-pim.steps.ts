import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { World } from '../support/world.js';
import { LoginPage } from '../pages/LoginPage.js';
import { DashboardPage } from '../pages/DashboardPage.js';

Given('the admin user is on the login page', async function (this: World) {
  await this.page.goto(new URL('/web/index.php/auth/login', this.baseURL).toString());
});

When('the admin signs in with valid credentials', async function (this: World) {
  const loginPage = new LoginPage(this.page);
  await loginPage.login(
    process.env.ORANGEHRM_USER ?? 'admin',
    process.env.ORANGEHRM_PASS ?? 'admin123'
  );
});

Then('the Dashboard should be visible', async function (this: World) {
  const loginPage = new LoginPage(this.page);
  await loginPage.assertDashboardVisible();
});

When('the admin clicks on the PIM link', async function (this: World) {
  const dashboardPage = new DashboardPage(this.page);
  await dashboardPage.openPIM();
});

Then('the Employee Information page should be visible', async function (this: World) {
  const dashboardPage = new DashboardPage(this.page);
  await dashboardPage.assertEmployeeInformationVisible();
});
