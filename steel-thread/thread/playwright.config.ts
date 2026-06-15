import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { loadProfile } from '../../toolkit/profile.mjs';

/**
 * The SAME compiled spec runs against every TARGET in the active profile. That
 * identical run is the experiment: if all targets pass, the role + accessible-name
 * locators are framework-independent (the core argument for discovery over
 * per-framework static parsers). The fundflow profile defines react + angular.
 *
 * Select a profile with QA_PROFILE / QA_PROFILE_PATH (see profiles/README.md).
 * The mock API for fundflow must be up on :4000.
 */
const profile = loadProfile();

// Session-mode auth (SSO/MFA): start every context from the captured authenticated
// state, so specs begin logged in (no login step). Form-mode profiles ignore this.
const storageState =
  profile.auth?.mode === 'session' && existsSync(profile.auth.statePath)
    ? profile.auth.statePath
    : undefined;

export default defineConfig({
  testDir: profile.workDir,
  // Recursive so per-journey subdirs (test_generator writes <workDir>/<journeyId>/)
  // are discovered, alongside flat specs (fundflow's generated/*.spec.ts).
  testMatch: '**/*.spec.ts',
  // API tests are request-only and run under their own config (api.config.ts).
  testIgnore: '**/*.api.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Live external targets (e.g. orangehrm) can be slow to load; one retry +
  // navigation headroom so a transient remote stall isn't a false failure.
  // Localhost profiles (fundflow) are fast and deterministic, so this is harmless.
  retries: 1,
  reporter: [['list']],
  use: {
    trace: 'on-first-retry',
    headless: true,
    navigationTimeout: 60_000,
    storageState,
  },
  projects: profile.targets.map((t) => ({
    name: t.name,
    use: { ...devices['Desktop Chrome'], baseURL: t.baseURL },
  })),
});
