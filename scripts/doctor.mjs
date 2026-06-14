#!/usr/bin/env node
/**
 * doctor.mjs — preflight check so a cold clone fails loud (and early) instead of
 * deep inside a crawl. Run `npm run doctor` (add `--url <app>` or set QA_PROFILE
 * to also check your target app is reachable).
 *
 * Reports [OK] / [WARN] / [FAIL] per check. Exits non-zero only on a hard FAIL
 * (node/npm). Everything else is guidance.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const add = (status, label, detail = '') => results.push({ status, label, detail });

function sh(cmd) {
  const r = spawnSync('bash', ['-lc', cmd], { encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

async function reachable(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'manual' });
    return res.status;
  } catch { return null; } finally { clearTimeout(t); }
}

function envKeyPresent(name) {
  if (process.env[name]) return 'environment';
  for (const f of ['toolkit/gateway/.env', 'steel-thread/.env']) {
    const p = join(ROOT, f);
    if (existsSync(p) && new RegExp(`^${name}=\\S`, 'm').test(readFileSync(p, 'utf8'))) return f;
  }
  return null;
}

function playwrightBrowsersDir() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  const h = homedir();
  if (platform() === 'darwin') return join(h, 'Library', 'Caches', 'ms-playwright');
  if (platform() === 'win32') return join(h, 'AppData', 'Local', 'ms-playwright');
  return join(h, '.cache', 'ms-playwright');
}

async function main() {
  // 1. Node
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) add('ok', 'Node', `v${process.versions.node} (20.12+ recommended for .env autoload)`);
  else add('fail', 'Node', `v${process.versions.node} — need >= 20`);

  // 2. npm
  const npm = sh('npm -v');
  add(npm.ok ? 'ok' : 'fail', 'npm', npm.ok ? `v${npm.out}` : 'not found');

  // 3. agent-browser (discovery)
  const ab = sh('agent-browser --version');
  add(ab.ok ? 'ok' : 'warn', 'agent-browser', ab.ok ? ab.out : 'not found — needed for discovery: npm i -g agent-browser && agent-browser install');

  // 4. deps installed
  for (const pkg of ['toolkit/gateway', 'steel-thread/thread', 'runner']) {
    add(existsSync(join(ROOT, pkg, 'node_modules')) ? 'ok' : 'warn', `deps: ${pkg}`,
      existsSync(join(ROOT, pkg, 'node_modules')) ? 'installed' : 'missing — run: npm run setup');
  }

  // 5. Playwright Chromium
  const pwDir = playwrightBrowsersDir();
  const hasChromium = existsSync(pwDir) && readdirSync(pwDir).some((d) => /^chromium/.test(d));
  add(hasChromium ? 'ok' : 'warn', 'Playwright Chromium', hasChromium ? `present (${pwDir})` : 'missing — run: npm run setup (or npx playwright install chromium)');

  // 6. Model provider key (never printed)
  const anthropic = envKeyPresent('ANTHROPIC_API_KEY');
  const azure = envKeyPresent('AZURE_OPENAI_API_KEY');
  if (anthropic) add('ok', 'Model key', `ANTHROPIC_API_KEY found (${anthropic})`);
  else if (azure) add('ok', 'Model key', `AZURE_OPENAI_API_KEY found (${azure})`);
  else add('warn', 'Model key', 'none found — model-mode (generate/heal) needs one in toolkit/gateway/.env');

  // 7. Gateway running?
  const health = await reachable('http://localhost:4100/healthz', 2000);
  if (health === 200) {
    const j = await (await fetch('http://localhost:4100/healthz')).json().catch(() => null);
    add('ok', 'Gateway :4100', j ? `up — provider ${Object.entries(j.providers || {}).map(([k, v]) => `${k}=${v}`).join(',')}, credential=${j.credentialProvider}` : 'up');
  } else {
    add('info', 'Gateway :4100', 'not running (start when needed: cd toolkit/gateway && npm start)');
  }

  // 8. Target app reachability (optional)
  const urlArg = (process.argv.find((a) => a.startsWith('--url=')) || '').split('=')[1]
    || (process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : null);
  let targetUrl = urlArg;
  if (!targetUrl && process.env.QA_PROFILE) {
    try {
      const { loadProfile } = await import('../toolkit/profile.mjs');
      targetUrl = loadProfile().targets?.[0]?.baseURL || null;
    } catch { /* ignore */ }
  }
  if (targetUrl) {
    const code = await reachable(targetUrl);
    add(code ? 'ok' : 'warn', 'Target app', code ? `${targetUrl} → HTTP ${code}` : `${targetUrl} unreachable — check VPN / cert / allowed-domains`);
  } else {
    add('info', 'Target app', 'not checked (pass --url <app> or set QA_PROFILE)');
  }

  // Report
  const icon = { ok: '[OK]  ', warn: '[WARN]', fail: '[FAIL]', info: '[..]  ' };
  console.log('\nqa-evergreen doctor\n');
  for (const r of results) console.log(`${icon[r.status]} ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
  const fails = results.filter((r) => r.status === 'fail').length;
  const warns = results.filter((r) => r.status === 'warn').length;
  console.log(`\n${fails ? '✗' : '✓'} ${fails} failed, ${warns} warnings. ${fails ? 'Fix failures before running.' : warns ? 'Warnings are optional but recommended.' : 'Ready.'}`);
  process.exit(fails ? 1 : 0);
}

main();
