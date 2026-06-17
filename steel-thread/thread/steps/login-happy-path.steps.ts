import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { World } from '../support/world.js';
import { LoginPage } from '../pages/LoginPage.js';

Given('the admin is on the OrangeHRM login page', async function (this: World) {
  const loginPage = new LoginPage(this.page);
  await loginPage.navigate(this.baseURL);
});

When('the admin signs in with username {string} and password {string}', async function (this: World, username: string, password: string) {
  const loginPage = new LoginPage(this.page);
  await loginPage.login(username, password);
});

Then('the dashboard heading should be visible', async function (this: World) {
  const loginPage = new LoginPage(this.page);
  await loginPage.assertDashboardVisible();
});
