import { defineConfig } from '@playwright/test';
import { loadProfile } from '../../toolkit/profile.mjs';

/**
 * Dedicated config for generated API tests (status + zod schema validation).
 * Separate from playwright.config.ts (UI) because these are request-only tests
 * (no browser) and must not run under the per-target browser projects.
 * Run: QA_PROFILE=<name> npx playwright test --config=api.config.ts
 */
const profile = loadProfile();

export default defineConfig({
  testDir: profile.workDir,
  testMatch: '**/*.api.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  reporter: [['list']],
  projects: [{ name: 'api' }],
});
