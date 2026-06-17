import { Before, After, setDefaultTimeout, ITestCaseHookParameter } from '@cucumber/cucumber';
import { chromium } from '@playwright/test';
import { World } from './world.js';

// Live external apps can be slow to load — generous per-step timeout.
setDefaultTimeout(60_000);

Before(async function (this: World) {
  this.browser = await chromium.launch({ headless: true });
  this.context = await this.browser.newContext();
  this.context.setDefaultNavigationTimeout(60_000);
  this.page = await this.context.newPage();
});

After(async function (this: World, _scenario: ITestCaseHookParameter) {
  await this.page?.close();
  await this.context?.close();
  await this.browser?.close();
});
