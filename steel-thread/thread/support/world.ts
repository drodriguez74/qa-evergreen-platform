import { setWorldConstructor, World as CucumberWorld, IWorldOptions } from '@cucumber/cucumber';
import { Browser, BrowserContext, Page } from '@playwright/test';

// Default base URL discovered for this profile's target. Override at runtime with
// QA_BASE_URL to point the same suite at a different target (e.g. react vs angular).
const DEFAULT_BASE_URL = "https://opensource-demo.orangehrmlive.com";

export class World extends CucumberWorld {
  browser!: Browser;
  context!: BrowserContext;
  page!: Page;
  readonly baseURL: string;

  constructor(options: IWorldOptions) {
    super(options);
    this.baseURL = process.env.QA_BASE_URL || DEFAULT_BASE_URL;
  }
}

setWorldConstructor(World);
export default World;
