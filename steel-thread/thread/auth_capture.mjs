#!/usr/bin/env node
/**
 * auth_capture.mjs — capture an authenticated session for SESSION-mode auth.
 *
 * Saves a Playwright `storageState` JSON (cookies + web storage) to the profile's
 * `auth.statePath`. That one file is reused by BOTH the test run (Playwright
 * `storageState`) and discovery (agent-browser `--state`), so the platform works
 * against SSO/MFA apps where the login can't be scripted.
 *
 * Modes:
 *   --manual  open a HEADED browser at the target; YOU log in (SSO / MFA included),
 *             then press Enter here to save the session. Needs a display — this is
 *             the path for a real corporate app.
 *   (default) headless scripted replay of the login journey's role+name actions
 *             (user/pass, MFA bypassed). Good for form apps, CI, and testing.
 *
 * Run from steel-thread/thread:  QA_PROFILE=<name> npm run auth:capture           (scripted)
 *                                QA_PROFILE=<name> npm run auth:capture -- --manual (SSO/MFA)
 */

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { loadProfile } from '../../toolkit/profile.mjs';

const profile = loadProfile();
const manual = process.argv.includes('--manual');

const target = profile.targets[0];
if (!target) throw new Error(`profile ${profile.name} has no targets`);
const journey = profile.journeys.find((j) => /login/i.test(j.id)) || profile.journeys[0];
const entryPath = journey?.entryPath || '/';
const url = target.baseURL.replace(/\/$/, '') + entryPath;

function waitForEnter(msg) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(msg, () => { rl.close(); res(); });
  });
}

async function replayLogin(page) {
  const step = (journey?.steps || []).find((s) => s.gating) || journey?.steps?.[0];
  if (!step) throw new Error(`profile ${profile.name} has no journey steps to replay — use --manual`);
  for (const a of step.actions || []) {
    const loc = page.getByRole(a.target.role, { name: a.target.name });
    if (a.kind === 'fill') await loc.fill(a.value);
    else if (a.kind === 'click') await loc.click();
    else if (a.kind === 'select') await loc.selectOption(a.value);
  }
}

async function main() {
  const browser = await chromium.launch({ headless: !manual });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  if (manual) {
    console.log(`\nauth-capture: a browser window is open at ${url}`);
    console.log('Log in (SSO / MFA included). Once the app is logged in, return here.');
    await waitForEnter('Press Enter to save the authenticated session... ');
  } else {
    console.log(`auth-capture: replaying login for ${profile.name} (headless)...`);
    await replayLogin(page);
    await page.waitForTimeout(2500); // let auth/cookies settle
  }

  mkdirSync(dirname(profile.auth.statePath), { recursive: true });
  await context.storageState({ path: profile.auth.statePath });
  await browser.close();

  console.log(`auth-capture: saved session → ${profile.auth.statePath}`);
  console.log(`  Set  "auth": { "mode": "session" }  in profiles/${profile.name}.json to use it,`);
  console.log('  and author session-mode journeys that start on a protected page (no login step).');
}

main().catch((e) => { console.error(e); process.exit(1); });
