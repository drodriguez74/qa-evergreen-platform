#!/usr/bin/env node
/**
 * eject.mjs — graduate a profile into a standalone QA repo (AGENTS.md / HANDOFF.md).
 *
 * RECONSTRUCTED FROM SPEC — verify against office code.
 *   The session audit DESCRIBES eject's contract (what it generates, its flags,
 *   the post-eject lifecycle) but does not quote its source. This is a faithful
 *   implementation of the documented behaviour; cross-check against office code.
 *
 * Copies a self-contained profiles/<app>/ Cucumber project into a standalone
 * directory and seeds the repo scaffolding a QA team needs to own it:
 *   .gitignore  .env.example  README.md  AGENTS.md  .github/workflows/test.yml
 *   + git init + an initial commit referencing the platform's current commit.
 *
 * Generic — no app specifics are hardcoded; everything derives from the profile
 * folder (its package.json, features/, profile.json, proxy hints).
 *
 * Lifecycle (audit): platform generates → eject to app repo → QA team owns it.
 *   Re-discovery happens back in the platform; diff + cherry-pick into the app
 *   repo. No continuous sync — the ejected repo is the source of truth for tests.
 *
 * Usage:
 *   node toolkit/agents/eject.mjs <app> [--out <path>] [--org <github-org>] [--no-push]
 *     --out <path>   destination dir (default: ../<app>-qa next to the repo)
 *     --org <org>    print a `gh repo create <org>/<app>-qa` push command
 *     --no-push      local only; skip printing remote/push guidance
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

// --- args -------------------------------------------------------------------

const argv = process.argv.slice(2);
const app = argv.find((a) => !a.startsWith('--'));
if (!app) {
  console.error('usage: node toolkit/agents/eject.mjs <app> [--out <path>] [--org <github-org>] [--no-push]');
  process.exit(1);
}
function flag(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : null;
}
const outArg = flag('--out');
const org = flag('--org');
const noPush = argv.includes('--no-push');

const SRC = resolve(REPO_ROOT, 'profiles', app);
if (!existsSync(SRC)) throw new Error(`profile not found: ${SRC} (eject works on directory profiles profiles/<app>/)`);
if (!existsSync(join(SRC, 'profile.json'))) throw new Error(`${SRC} has no profile.json — not a self-contained profile`);

const OUT = outArg && typeof outArg === 'string' ? resolve(process.cwd(), outArg) : resolve(REPO_ROOT, '..', `${app}-qa`);

// --- read source profile facts ----------------------------------------------

function readJson(p, fallback = null) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
}
const profileJson = readJson(join(SRC, 'profile.json'), {});
const pkgJson = readJson(join(SRC, 'package.json'), {});
const pkgName = pkgJson.name || `qa-${app}`;

// Count features cross-platform (NO `find | wc -l` — POSIX-only). readdirSync
// + filter works identically on Windows/macOS/Linux.
function countFeatures() {
  const dir = join(SRC, 'features');
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith('.feature')).length;
}
const featureCount = countFeatures();

// Detect proxy need from the profile (apps behind a corporate proxy declare it).
const needsProxy = JSON.stringify(profileJson).includes('proxy') || Boolean(profileJson.proxy) || Boolean(profileJson.targets?.[0]?.proxy);

// Collect credential placeholder env var names from the profile (for .env.example).
function collectEnvVars() {
  const found = new Set();
  const walk = (v) => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(/\$\{([A-Z0-9_]+)\}/g)) found.add(m[1]);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(profileJson);
  return [...found];
}
const envVars = collectEnvVars();

// Current platform commit for traceability in the initial commit message.
function platformCommit() {
  const r = spawnSync('git', ['-C', REPO_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '(unknown)';
}
const PLATFORM_COMMIT = platformCommit();

// --- scaffold contents ------------------------------------------------------

const GITIGNORE = `node_modules/
.env
test-results/
out/
playwright-report/
*.log
`;

const ENV_EXAMPLE =
  `# Copy to .env and fill in. These are read by support/ (World) and the runner.\n` +
  (envVars.length ? envVars.map((v) => `${v}=`).join('\n') + '\n' : '# (no credential placeholders detected in profile.json)\n') +
  (needsProxy ? `\n# Corporate proxy (this app needs outbound proxy)\nQA_PROXY=http://your-proxy.example.com:8080\nHTTPS_PROXY=http://your-proxy.example.com:8080\n` : '');

const README = `# ${pkgName}

Self-contained QA automation for **${app}**, ejected from the QA Evergreen Platform
(platform commit \`${PLATFORM_COMMIT}\`). Cucumber-JS + Playwright; locators are
ARIA role + accessible name only (portable across frameworks).

## Quick start

\`\`\`bash
npm install
npx playwright install chromium
cp .env.example .env   # fill in credentials${needsProxy ? ' + proxy' : ''}
npm test               # runs the Cucumber suite (${featureCount} feature file${featureCount === 1 ? '' : 's'})
\`\`\`

## Structure

\`\`\`
features/   Gherkin .feature files (the scenarios)
steps/      step definitions (Given/When/Then → Page Object calls)
pages/      Page Object Models (role+name locators)
support/    Cucumber World + hooks (browser lifecycle)
profile.json  discovery config (targets, journeys, intents) — kept for re-discovery
\`\`\`

## Re-discovery

This repo is the source of truth for the tests. To pick up app changes, re-run the
platform's agents against \`profile.json\`, diff the regenerated \`features/\`,
\`steps/\`, \`pages/\`, and cherry-pick the deltas here. There is no continuous sync.
${needsProxy ? '\n## Proxy\n\nThis app is behind a corporate proxy. Set `HTTPS_PROXY` for Playwright browser\ndownloads and `QA_PROXY` for the World (see `.env.example`).\n' : ''}`;

const AGENTS = `# AGENTS.md

Guidance for any coding agent working in this ejected QA repo for **${app}**.

## Golden rules

1. **Locate by ARIA role + accessible name only.** \`getByRole\` / \`getByLabel\` with
   the exact accessible name. Never CSS selectors, data-testid, XPath, or @ref in
   committed tests. This portability is the platform's core bet.
2. **Honor the assertion bar.** Every UI scenario asserts a state change the action
   *caused* (a node present after that was absent before) — not merely a URL change.
3. **Secrets live only in \`.env\`** (gitignored). Synthetic/demo creds only in any
   committed fixture.
4. **Generated artifacts are regenerable.** Don't hand-fix a drifted locator; re-run
   discovery in the platform and cherry-pick. Lower-tier locators are flagged as
   \`// LOCATOR DEBT\` — fix the app's ARIA, don't hide the debt.

## Project structure

\`features/\` · \`steps/\` · \`pages/\` · \`support/\` — a standard flat Cucumber-JS project.
\`npm test\` runs the suite.

## Don't

- Don't use CSS/testid/XPath locators in committed tests.
- Don't assert navigation alone; assert the caused state change.
- Don't commit \`.env\`, \`node_modules\`, \`out/\`, or \`test-results/\`.
`;

const CI = `name: ${app}-qa

on:
  pull_request:
  schedule:
    - cron: '0 6 * * *'   # nightly regression (06:00 UTC)
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm test
        env:
${envVars.map((v) => `          ${v}: \${{ secrets.${v} }}`).join('\n') || '          PLACEHOLDER: ""'}
${needsProxy ? '          HTTPS_PROXY: ${{ secrets.HTTPS_PROXY }}\n          QA_PROXY: ${{ secrets.QA_PROXY }}\n' : ''}`;

// --- run --------------------------------------------------------------------

function git(args) {
  const r = spawnSync('git', ['-C', OUT, ...args], { encoding: 'utf8' });
  return { ok: r.status === 0, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

function main() {
  if (existsSync(OUT)) {
    if (readdirSync(OUT).length) throw new Error(`destination ${OUT} exists and is not empty — choose another --out`);
  }
  mkdirSync(OUT, { recursive: true });

  // Copy the profile folder, excluding ephemeral/generated dirs.
  cpSync(SRC, OUT, {
    recursive: true,
    filter: (src) => {
      const rel = src.slice(SRC.length + 1);
      const top = rel.split(/[\\/]/)[0];
      return !['node_modules', 'out', 'test-results', '.git', 'playwright-report'].includes(top);
    },
  });
  // Never carry a real .env into the new repo.
  rmSync(join(OUT, '.env'), { force: true });

  // Write scaffolding.
  writeFileSync(join(OUT, '.gitignore'), GITIGNORE);
  writeFileSync(join(OUT, '.env.example'), ENV_EXAMPLE);
  writeFileSync(join(OUT, 'README.md'), README);
  writeFileSync(join(OUT, 'AGENTS.md'), AGENTS);
  mkdirSync(join(OUT, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(OUT, '.github', 'workflows', 'test.yml'), CI);

  // git init + initial commit referencing the platform commit.
  const init = git(['init']);
  if (!init.ok) {
    console.warn(`eject: git init failed (${init.stderr}); files are in place at ${OUT} — init manually.`);
  } else {
    git(['add', '-A']);
    const commit = git(['commit', '-m', `chore: eject ${app} from qa-evergreen-platform @ ${PLATFORM_COMMIT}\n\nSelf-contained Cucumber-JS QA repo (${featureCount} feature file${featureCount === 1 ? '' : 's'}).`]);
    if (!commit.ok && !/nothing to commit/.test(commit.stderr + commit.stdout)) {
      console.warn(`eject: initial commit note — ${commit.stderr || commit.stdout}`);
    }
  }

  console.log(`eject: ${app} → ${OUT}`);
  console.log(`  ${featureCount} feature file${featureCount === 1 ? '' : 's'}, package "${pkgName}"${needsProxy ? ', proxy-aware' : ''}`);
  console.log(`  scaffolded: .gitignore, .env.example, README.md, AGENTS.md, .github/workflows/test.yml`);

  if (!noPush) {
    if (org) {
      console.log(`\neject: to create + push the GitHub repo:`);
      console.log(`  cd ${OUT}`);
      console.log(`  gh repo create ${org}/${app}-qa --private --source=. --remote=origin --push`);
    } else {
      console.log(`\neject: to push to a remote:`);
      console.log(`  cd ${OUT} && git remote add origin <url> && git push -u origin HEAD`);
      console.log(`  (or pass --org <github-org> to get a gh repo create command)`);
    }
  }
}

main();
