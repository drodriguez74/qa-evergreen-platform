// profile.mjs — the platform's per-target PROFILE loader.
//
// The platform is a reusable parent; each application it tests is a *profile*
// that overrides the parent defaults (plan §11's "reference + per-repo overrides"
// model). One profile == one gateway repo id, so cost/quota/audit/latency are
// attributed per target automatically.
//
// Resolution order for the active profile:
//   1. explicit argument to loadProfile()
//   2. QA_PROFILE_PATH        — absolute/relative path to a profile JSON
//   3. QA_PROFILE             — a name → profiles/<name>.json (in this repo, or
//                               QA_PROFILE_DIR for an external profiles dir)
//   4. default: 'fundflow'
//
// Path fields inside a profile (contract, api.openapi) resolve as: absolute →
// as-is; else relative to (profile.baseDir | QA_PROFILE_BASEDIR | repo root).
// A consumer repo can therefore keep its profile + app outside this platform.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
// The test-runner home — where @playwright/test is installed. Per-profile work
// dirs live under it so generated specs resolve the runner's node_modules. (A
// future platform package would own its own runner; for now the steel thread does.)
const TEST_HOME = resolve(REPO_ROOT, 'steel-thread', 'thread');
const PROFILES_DIR = process.env.QA_PROFILE_DIR
  ? resolve(process.cwd(), process.env.QA_PROFILE_DIR)
  : resolve(REPO_ROOT, 'profiles');

const DEFAULTS = {
  description: '',
  gateway: { url: process.env.QA_GATEWAY_URL || 'http://localhost:4100' },
  api: { baseURL: null, openapi: null, resetPath: '/api/reset' },
  targets: [],   // [{ name, baseURL }] — the SAME spec runs against each
  journeys: [],  // [{ id, role }]
  // How the target authenticates:
  //   form    (default) — login is a journey step (user/pass; MFA bypassed)
  //   session           — reuse a captured authenticated state (SSO/MFA). The
  //                       state JSON (cookies + storage) is shared by agent-browser
  //                       (--state) and Playwright (storageState).
  auth: { mode: 'form', statePath: null },
};

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(base[k] || {}, v) : v;
  }
  return out;
}

function resolveProfilePath(nameOrPath) {
  const explicit = nameOrPath || process.env.QA_PROFILE_PATH;
  if (explicit) return resolve(process.cwd(), explicit);
  const name = process.env.QA_PROFILE || 'fundflow';
  return resolve(PROFILES_DIR, `${name}.json`);
}

/**
 * Load and normalise the active profile.
 * @returns {{name, description, contract, api, targets, journeys, gateway, baseDir, profilePath, raw}}
 */
export function loadProfile(nameOrPath) {
  const profilePath = resolveProfilePath(nameOrPath);
  if (!existsSync(profilePath)) {
    throw new Error(`profile not found: ${profilePath} (set QA_PROFILE, QA_PROFILE_PATH, or create profiles/<name>.json)`);
  }
  const raw = JSON.parse(readFileSync(profilePath, 'utf8'));
  const merged = deepMerge(DEFAULTS, raw);

  const baseDir = merged.baseDir
    ? resolve(dirname(profilePath), merged.baseDir)
    : (process.env.QA_PROFILE_BASEDIR ? resolve(process.cwd(), process.env.QA_PROFILE_BASEDIR) : REPO_ROOT);
  const rel = (p) => (p == null ? null : isAbsolute(p) ? p : resolve(baseDir, p));

  if (!merged.name) throw new Error(`profile ${profilePath} is missing "name"`);

  // Per-profile work dir (trace + generated tests). fundflow keeps its historical
  // location; every other profile gets an isolated dir so testDirs never overlap.
  const workDir = merged.workDir
    ? rel(merged.workDir)
    : (merged.name === 'fundflow' ? resolve(TEST_HOME, 'generated') : resolve(TEST_HOME, 'out', merged.name));

  // Auth state JSON (cookies + storage) for session mode; default .auth/<name>.json
  // at repo root (gitignored — it holds live session tokens).
  const auth = {
    mode: merged.auth.mode || 'form',
    statePath: rel(merged.auth.statePath) || resolve(REPO_ROOT, '.auth', `${merged.name}.json`),
  };

  return {
    name: merged.name,
    description: merged.description,
    contract: rel(merged.contract),
    api: { ...merged.api, openapi: rel(merged.api.openapi) },
    targets: merged.targets,
    journeys: merged.journeys,
    gateway: merged.gateway,
    auth,
    workDir,
    baseDir,
    profilePath,
    raw,
  };
}
