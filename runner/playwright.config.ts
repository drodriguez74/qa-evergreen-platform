import { defineConfig, devices } from '@playwright/test';
import { loadProfile } from '../toolkit/profile.mjs';

/**
 * Profile-aware config for the DEDICATED runner package.
 *
 * Same shape as steel-thread/thread/playwright.config.ts: the SAME compiled spec
 * runs against every TARGET in the active profile (the framework-independence
 * experiment), testDir = profile.workDir, testMatch '**\/*.spec.ts', projects
 * derived from profile.targets, navigationTimeout 60s, retries 1, headless.
 *
 * The ONE difference vs the steel-thread config is provenance: @playwright/test
 * is resolved from THIS package's node_modules (runner/node_modules), not
 * steel-thread/thread/node_modules. That decoupling is the whole point — a spec
 * no longer has to live under steel-thread/thread to be runnable.
 *
 * NOTE: profile.workDir today still points under steel-thread/thread (the loader
 * is unchanged — read-only per task rules). A future migration would point
 * workDir at a repo-root location (e.g. runs/<profile>/) and run it through this
 * config. See runner/README.md. The runner.example.config.ts proves the
 * decoupling now, against a spec that lives under runner/example.
 */
const profile = loadProfile();

export default defineConfig({
  testDir: profile.workDir,
  // Recursive so per-journey subdirs (test_generator writes <workDir>/<journeyId>/)
  // are discovered, alongside flat specs.
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Live external targets can be slow to load; one retry + navigation headroom so
  // a transient remote stall isn't a false failure. Localhost profiles are
  // deterministic, so this is harmless there.
  retries: 1,
  reporter: [['list']],
  use: {
    trace: 'on-first-retry',
    headless: true,
    navigationTimeout: 60_000,
  },
  projects: profile.targets.map((t) => ({
    name: t.name,
    use: { ...devices['Desktop Chrome'], baseURL: t.baseURL },
  })),
});
