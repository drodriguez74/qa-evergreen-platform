import { defineConfig, devices } from '@playwright/test';

/**
 * SELF-CONTAINED proof config for the dedicated runner package.
 *
 * Unlike playwright.config.ts (which is profile-aware), this config has zero
 * external dependencies — no profile loader, no gateway. It points testDir at
 * runner/example (a spec that lives OUTSIDE steel-thread/thread) and hardcodes
 * the OrangeHRM live baseURL. Running this green proves the runner's own
 * @playwright/test (runner/node_modules) can execute a spec from anywhere.
 *
 *   npm run test:example   (from runner/)
 */
export default defineConfig({
  testDir: './example',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'https://opensource-demo.orangehrmlive.com',
    trace: 'on-first-retry',
    headless: true,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: 'orangehrm',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
