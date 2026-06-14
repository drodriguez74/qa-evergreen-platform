#!/usr/bin/env node
/**
 * setup.mjs — one-command bootstrap so a cold clone runs with minimal fuss.
 *
 * Installs deps for the platform essentials, the Playwright browser, and points
 * you at agent-browser. Run `npm run setup` (add `--demo` to also install the
 * FundFlow steel-thread demo apps; `--with-agent-browser` to global-install the
 * agent-browser CLI). Then `npm run doctor` to verify.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demo = process.argv.includes('--demo');
const withAB = process.argv.includes('--with-agent-browser');

function run(cmd, cwd) {
  console.log(`\n$ (${cwd.replace(ROOT, '.')}) ${cmd}`);
  const r = spawnSync('bash', ['-lc', cmd], { cwd, stdio: 'inherit' });
  return r.status === 0;
}

const essentials = ['toolkit/gateway', 'steel-thread/thread', 'runner'];
const demoApps = ['steel-thread/api', 'steel-thread/apps/react', 'steel-thread/apps/angular'];
const targets = [...essentials, ...(demo ? demoApps : [])];

console.log('qa-evergreen setup: installing dependencies' + (demo ? ' (incl. demo apps)' : ''));
let ok = true;
for (const pkg of targets) {
  const dir = join(ROOT, pkg);
  if (!existsSync(join(dir, 'package.json'))) { console.log(`  skip ${pkg} (no package.json)`); continue; }
  if (!run('npm install', dir)) { ok = false; console.error(`  ✗ npm install failed in ${pkg}`); }
}

// Playwright browser (Chromium) — needed to run compiled specs.
console.log('\nqa-evergreen setup: installing the Playwright Chromium browser...');
run('npx playwright install chromium', join(ROOT, 'steel-thread/thread'));

// agent-browser (Node CLI) — needed for live discovery.
const hasAB = spawnSync('bash', ['-lc', 'command -v agent-browser'], { encoding: 'utf8' }).status === 0;
if (hasAB) {
  console.log('\nqa-evergreen setup: agent-browser is installed ✓');
} else if (withAB) {
  console.log('\nqa-evergreen setup: installing agent-browser globally...');
  run('npm i -g agent-browser && agent-browser install', ROOT);
} else {
  console.log('\nqa-evergreen setup: agent-browser NOT found (needed for discovery).');
  console.log('  Install it:  npm i -g agent-browser && agent-browser install');
  console.log('  (or re-run: npm run setup -- --with-agent-browser)');
}

console.log('\n' + (ok ? '✓ setup complete.' : '⚠ setup finished with errors above.'));
console.log('Next:');
console.log('  1. Put your model key in toolkit/gateway/.env (e.g. ANTHROPIC_API_KEY=...)');
console.log('  2. npm run doctor            # verify environment (add --url <yourapp> to check reachability)');
console.log('  3. See docs/cookbook.md → "Onboard a new app"');
process.exit(ok ? 0 : 1);
