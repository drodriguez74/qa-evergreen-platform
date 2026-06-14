#!/usr/bin/env node
/**
 * verify_crawl.mjs — steel-thread VERIFICATION CRAWL (plan §19.1).
 *
 * For each role (analyst, supervisor) this signs in through the FundFlow UI,
 * walks the directly-reachable routes, captures an interactive accessibility
 * snapshot per route, and DIFFS the live a11y tree against the authoritative
 * contract (shared/a11y-contract.md). It produces:
 *
 *   generated/verification-report.md  — per-role / per-route FOUND/MISSING
 *                                        tables, an UNDOCUMENTED list, and an
 *                                        "Accessibility / locator debt" section.
 *   generated/verification.json       — raw machine-readable findings.
 *
 * Primary success criterion: catch the DELIBERATE a11y defect — the dashboard
 * menu toggle rendered as a role-less <div>/<span> (a ☰ glyph with an onclick,
 * no role, no accessible name). It is invisible to getByRole and reproduces the
 * saucedemo swallowed-click defect (plan §19.6).
 *
 * Boundaries (plan §19.5 / §20.5):
 *   - agent-browser fenced to localhost via --allowed-domains localhost.
 *   - dedicated --session verify-crawl (off the machine-shared default session).
 *   - `agent-browser close --all` runs in a finally block.
 *
 * Driven via the agent-browser command forms proven in discover.mjs (v0.27):
 *   - text inputs → `find label <name> fill <value>`
 *   - buttons     → `find role button click --name <name>`
 *   - a login shell (`bash -lc`) so PATH/nvm resolve agent-browser.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATED = join(__dirname, 'generated');
const REPORT_PATH = join(GENERATED, 'verification-report.md');
const JSON_PATH = join(GENERATED, 'verification.json');

const REACT_BASE = process.env.STEEL_THREAD_REACT_URL || 'http://localhost:5173';
const SESSION = 'verify-crawl';
const ALLOWED_DOMAINS = 'localhost';

// ---------------------------------------------------------------------------
// agent-browser invocation helpers (proven forms from discover.mjs)
// ---------------------------------------------------------------------------

function ab(args, { json = false } = {}) {
  const full = ['agent-browser', ...args, '--session', SESSION];
  if (json) full.push('--json');
  const cmd = full.map(shellQuote).join(' ');
  const res = spawnSync('bash', ['-lc', cmd], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 16 });
  return {
    ok: res.status === 0,
    status: res.status,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
    error: res.error,
  };
}

function shellQuote(s) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** snapshot -i --json, parsed → { refs, snapshotText } or { error }. */
function snapshot() {
  const res = ab(['snapshot', '-i'], { json: true });
  if (!res.ok) return { error: res.stderr || res.error?.message || 'snapshot failed' };
  try {
    const j = JSON.parse(res.stdout);
    return {
      refs: j?.data?.refs ?? {},
      snapshotText: j?.data?.snapshot ?? '',
      origin: j?.data?.origin ?? null,
    };
  } catch {
    return { error: 'could not parse snapshot json', raw: res.stdout };
  }
}

/**
 * Full (non-interactive) snapshot text. The `-i` interactive snapshot omits
 * structural container roles such as `table` from its refs map; the contract
 * still promises those (a named `table "Accounts"`). We read the full tree text
 * to resolve those structural roles without false-flagging them as MISSING.
 */
function fullSnapshotText() {
  const res = ab(['snapshot'], { json: true });
  if (!res.ok) return '';
  try {
    return JSON.parse(res.stdout)?.data?.snapshot ?? '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// The contract, transcribed from shared/a11y-contract.md.
// Each screen lists the interactive / structural elements the contract promises,
// expressed purely as { role, name } (+ optional level for headings).
// These are the elements the verification crawl asserts FOUND vs MISSING.
// ---------------------------------------------------------------------------

const CONTRACT = {
  '/login': {
    screen: 'Sign in',
    flowOnly: false,
    elements: [
      { role: 'heading', name: 'Sign in to FundFlow', level: 1 },
      { role: 'textbox', name: 'Username' },
      { role: 'textbox', name: 'Password' },
      { role: 'button', name: 'Sign in' },
      // Error banner (alert "Invalid username or password") only renders on 401 —
      // not exercised on the happy-path crawl, so excluded from FOUND/MISSING.
    ],
  },
  '/dashboard': {
    screen: 'Dashboard',
    flowOnly: false,
    elements: [
      { role: 'heading', name: 'Dashboard', level: 1 },
      { role: 'heading', name: 'Account Balances', level: 2 },
      { role: 'table', name: 'Accounts' },
      { role: 'heading', name: 'Recent Activity', level: 2 },
      { role: 'table', name: 'Recent Activity' },
      { role: 'button', name: 'Initiate Transfer' },
      { role: 'button', name: 'Sign out' },
      // "Signed in as {displayName}" is plain text (role=text) and varies by user;
      // verified separately as a substring presence check, not in the table.
    ],
  },
  '/transfer': {
    screen: 'Initiate Transfer',
    flowOnly: false,
    elements: [
      { role: 'heading', name: 'Initiate Transfer', level: 1 },
      { role: 'combobox', name: 'From account' },
      { role: 'combobox', name: 'Payee' },
      { role: 'textbox', name: 'Amount' },
      { role: 'textbox', name: 'Memo' },
      { role: 'button', name: 'Continue to review' },
    ],
  },
  '/transfer/review': {
    screen: 'Review & Confirm',
    flowOnly: true, // requires mid-flow state — see decision note below.
    elements: [
      { role: 'heading', name: 'Review & Confirm', level: 1 },
      { role: 'button', name: 'Confirm transfer' },
      { role: 'button', name: 'Back' },
    ],
  },
  '/transfer/receipt/:id': {
    screen: 'Receipt',
    flowOnly: true,
    elements: [
      { role: 'heading', name: 'Transfer Complete', level: 1 },
      { role: 'button', name: 'Back to dashboard' },
    ],
  },
};

// Routes the crawl walks directly per role. /transfer/review and
// /transfer/receipt/:id require mid-flow state (an in-progress transfer) and are
// NOT directly addressable by URL, so this crawl marks them `flow-only` and
// skips them rather than attempting to manufacture the state. See the report's
// "Flow-only routes" note.
const DIRECT_ROUTES = ['/dashboard', '/transfer'];

const ROLES = [
  { username: 'analyst', password: 'demo1234', displayName: 'Avery Analyst' },
  { username: 'supervisor', password: 'demo1234', displayName: null },
];

// ---------------------------------------------------------------------------
// Snapshot analysis
// ---------------------------------------------------------------------------

/** A name is "effectively empty" if blank or only non-word glyph chars (e.g. ☰). */
function isEffectivelyEmptyName(name) {
  if (!name) return true;
  // strip whitespace and any non-alphanumeric "glyph" characters
  const stripped = name.replace(/[^\p{L}\p{N}]/gu, '').trim();
  return stripped.length === 0;
}

/**
 * Parse the text snapshot into line records carrying ref, role, name, and the
 * interaction flags agent-browser annotates (clickable / [onclick] / cursor).
 * The text tree is the only place these affordance flags appear; the refs map
 * carries only {role, name}.
 */
function parseSnapshotText(text) {
  const lines = String(text).split('\n');
  const records = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('-')) continue;
    const refMatch = line.match(/\[ref=(e\d+)\]/);
    const roleMatch = line.match(/^-\s*([a-zA-Z]+)\b/);
    // Accessible name is the first quoted token after the role. It may be
    // followed by a `[...]` attribute block (interactive snapshot) or nothing
    // (full snapshot structural nodes like `- table "Accounts"`).
    const nameMatch = line.match(/^-\s*[a-zA-Z]+\s+"([\s\S]*?)"(?:\s*\[|\s*$)/);
    records.push({
      ref: refMatch ? refMatch[1] : null,
      role: roleMatch ? roleMatch[1] : null,
      name: nameMatch ? nameMatch[1] : '',
      clickable: /\bclickable\b/.test(line),
      onclick: /\[?onclick\]?/.test(line) || /onclick/.test(line),
      cursorPointer: /cursor:pointer/.test(line),
      line,
    });
  }
  return records;
}

/** Build the interactive inventory (role + accessible name) from the refs map. */
function inventoryFromRefs(refs) {
  return Object.entries(refs).map(([ref, node]) => ({
    ref,
    role: node.role,
    name: node.name ?? '',
    source: 'refs',
  }));
}

/**
 * Merge structural roles (e.g. `table`) parsed from the full snapshot text into
 * the interactive inventory, so contract elements the `-i` snapshot omits are
 * still resolvable. Only roles NOT already present in refs are added.
 */
function withStructuralRoles(inventory, fullText) {
  const STRUCTURAL_ROLES = new Set(['table', 'list', 'navigation', 'banner', 'main', 'region']);
  const records = parseSnapshotText(fullText);
  let synth = 0;
  const have = new Set(inventory.map((n) => `${n.role}::${n.name}`));
  const merged = [...inventory];
  for (const r of records) {
    if (!STRUCTURAL_ROLES.has(r.role)) continue;
    const key = `${r.role}::${r.name}`;
    if (have.has(key)) continue;
    have.add(key);
    merged.push({ ref: r.ref || `s${synth++}`, role: r.role, name: r.name, source: 'full' });
  }
  return merged;
}

/** Diff a screen's contract against the live inventory. */
function diffScreen(contractElements, inventory) {
  const results = [];
  const matchedRefs = new Set();

  for (const expected of contractElements) {
    const hit = inventory.find(
      (n) =>
        n.role === expected.role &&
        n.name === expected.name &&
        !matchedRefs.has(n.ref),
    );
    if (hit) matchedRefs.add(hit.ref);
    results.push({
      role: expected.role,
      name: expected.name,
      ...(expected.level ? { level: expected.level } : {}),
      status: hit ? 'FOUND' : 'MISSING',
      ref: hit ? hit.ref : null,
    });
  }

  // UNDOCUMENTED: live nodes not matched to any contract element. We ignore the
  // option/cell/columnheader/generic "structure" roles that the contract covers
  // implicitly (table contents, the deliberately role-less container), and the
  // empty-name generic nodes (reported separately as a11y debt).
  const STRUCTURAL = new Set(['option', 'cell', 'columnheader', 'row', 'rowgroup', 'generic']);
  const undocumented = inventory
    .filter((n) => !matchedRefs.has(n.ref))
    .filter((n) => !STRUCTURAL.has(n.role))
    .filter((n) => !isEffectivelyEmptyName(n.name))
    .map((n) => ({ role: n.role, name: n.name, ref: n.ref }));

  return { results, undocumented };
}

/**
 * Detect "locator + a11y debt": interactive-but-inaccessible controls — nodes
 * that carry a click affordance (clickable / [onclick] / cursor:pointer, or are
 * generic with a click handler) yet expose role `generic` with an effectively
 * empty accessible name. These are unreachable by getByRole. The dashboard ☰
 * menu toggle MUST surface here (the deliberate defect, plan §19.6).
 */
function detectA11yDebt(snapshotText, route) {
  const records = parseSnapshotText(snapshotText);
  const debt = [];
  for (const r of records) {
    const clickAffordance = r.clickable || r.onclick || r.cursorPointer;
    const inaccessible = r.role === 'generic' && isEffectivelyEmptyName(r.name);
    if (clickAffordance && inaccessible) {
      const isGlyphToggle = /[☰]/.test(r.name) || (r.cursorPointer && /[^\w\s]/.test(r.name));
      debt.push({
        route,
        ref: r.ref,
        role: r.role,
        accessibleName: r.name,
        affordances: {
          clickable: r.clickable,
          onclick: r.onclick,
          cursorPointer: r.cursorPointer,
        },
        likelyMenuToggle: isGlyphToggle,
        note:
          'Interactive control with role="generic" and no accessible name — ' +
          'invisible to getByRole/getByLabel. Reproduces the saucedemo ' +
          'swallowed-click / invisible-control defect (plan §19.6).',
        snapshotLine: r.line,
      });
    }
  }
  return debt;
}

// ---------------------------------------------------------------------------
// Per-role crawl
// ---------------------------------------------------------------------------

function login(role) {
  const opened = ab(['open', `${REACT_BASE}/login`, '--allowed-domains', ALLOWED_DOMAINS]);
  if (!opened.ok) {
    throw new Error(
      `agent-browser could not open ${REACT_BASE}/login ` +
        `(${opened.stderr || opened.error?.message || 'unreachable'})`,
    );
  }
  ab(['wait', '900']);
  const u = ab(['find', 'label', 'Username', 'fill', role.username]);
  const p = ab(['find', 'label', 'Password', 'fill', role.password]);
  const s = ab(['find', 'role', 'button', 'click', '--name', 'Sign in']);
  if (!u.ok || !p.ok || !s.ok) {
    throw new Error(
      `login as ${role.username} failed ` +
        `(user:${u.ok} pass:${p.ok} submit:${s.ok} — ${s.stderr || p.stderr || u.stderr})`,
    );
  }
  ab(['wait', '1100']); // let /dashboard render after the redirect
}

function navigate(route) {
  ab(['open', `${REACT_BASE}${route}`, '--allowed-domains', ALLOWED_DOMAINS]);
  ab(['wait', '1000']); // SPA render settle
}

function crawlRole(role) {
  login(role);

  const routes = [];
  let signedInIndicatorFound = false;

  for (const route of DIRECT_ROUTES) {
    navigate(route);
    const snap = snapshot();
    if (snap.error) {
      routes.push({ route, error: snap.error, reachable: false });
      continue;
    }

    const fullText = fullSnapshotText();
    const inventory = withStructuralRoles(inventoryFromRefs(snap.refs), fullText);
    const { results, undocumented } = diffScreen(CONTRACT[route].elements, inventory);
    const a11yDebt = detectA11yDebt(snap.snapshotText, route);

    // Reachability: a route is "reachable" if its contract heading is present
    // (i.e. we landed on the real screen, not bounced back to /login).
    const heading = CONTRACT[route].elements.find((e) => e.role === 'heading');
    const reachable = results.some(
      (r) => r.role === 'heading' && r.name === heading?.name && r.status === 'FOUND',
    );

    // The "Signed in as {displayName}" text is plain text — confirm via substring
    // of the text snapshot rather than a role lookup.
    if (route === '/dashboard') {
      signedInIndicatorFound = /Signed in as\s+\S+/.test(snap.snapshotText);
    }

    routes.push({
      route,
      screen: CONTRACT[route].screen,
      reachable,
      results,
      undocumented,
      a11yDebt,
      liveInventory: inventory,
    });
  }

  return {
    role: role.username,
    displayName: role.displayName,
    routesWalked: DIRECT_ROUTES,
    signedInIndicatorFound,
    routes,
    flowOnlyRoutes: Object.entries(CONTRACT)
      .filter(([, v]) => v.flowOnly)
      .map(([route, v]) => ({ route, screen: v.screen })),
  };
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function md(findings) {
  const lines = [];
  lines.push('# FundFlow — Verification Crawl Report');
  lines.push('');
  lines.push(`- Generated: ${findings.generatedAt}`);
  lines.push(`- Target: React build (${findings.reactBaseUrl})`);
  lines.push(`- Contract: shared/a11y-contract.md`);
  lines.push(`- Driver: agent-browser ${findings.agentBrowserNote}`);
  lines.push(`- Session: ${SESSION} (fenced to ${ALLOWED_DOMAINS})`);
  lines.push('');
  lines.push(
    '> Each role signs in through the UI, then the crawl walks the directly-' +
      'reachable routes, snapshots the interactive accessibility tree, and diffs ' +
      'it against the contract. The `/transfer/review` and `/transfer/receipt/:id` ' +
      'screens require mid-flow state (an in-progress transfer) and are **not** ' +
      'directly addressable by URL, so they are marked **flow-only** and skipped ' +
      'by this crawl.',
  );
  lines.push('');

  // Aggregate a11y debt section first (it is the headline finding).
  const allDebt = [];
  for (const r of findings.roles) {
    for (const route of r.routes) {
      for (const d of route.a11yDebt || []) {
        allDebt.push({ ...d, crawlRole: r.role });
      }
    }
  }

  lines.push('## Accessibility / locator debt');
  lines.push('');
  if (allDebt.length === 0) {
    lines.push('_No interactive-but-inaccessible controls detected._');
  } else {
    lines.push(
      'The following nodes carry a click affordance (`clickable` / `[onclick]` / ' +
        '`cursor:pointer`) yet expose `role="generic"` with **no accessible name**. ' +
        'They are **unreachable by `getByRole` / `getByLabel`** and reproduce the ' +
        'saucedemo swallowed-click / invisible-control defect (plan §19.6).',
    );
    lines.push('');
    lines.push('| Crawl role | Route | ref | node role | accessible name | affordances | likely menu toggle |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const d of allDebt) {
      const aff = Object.entries(d.affordances)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(', ');
      const nameCell = d.accessibleName ? `\`${d.accessibleName}\`` : '_(empty)_';
      lines.push(
        `| ${d.crawlRole} | ${d.route} | ${d.ref ?? '—'} | ${d.role} | ${nameCell} | ${aff || '—'} | ${d.likelyMenuToggle ? '**YES — ☰ toggle**' : 'no'} |`,
      );
    }
    lines.push('');
    const toggles = allDebt.filter((d) => d.likelyMenuToggle);
    if (toggles.length) {
      lines.push(
        `> **Deliberate defect caught.** The dashboard menu toggle (the ☰ glyph) ` +
          `is rendered as a role-less \`<div>\`/\`<span>\` with an onclick and no ` +
          `accessible name — exactly the planted locator + a11y debt (plan §19.6). ` +
          `A \`getByRole('button', { name: 'Menu' })\` locator can never resolve it.`,
      );
      lines.push('');
    }
  }

  // Per-role, per-route tables.
  for (const r of findings.roles) {
    lines.push(`## Role: ${r.role}${r.displayName ? ` (${r.displayName})` : ''}`);
    lines.push('');
    lines.push(
      `- Signed in via UI: yes` +
        (r.role === 'analyst'
          ? `\n- "Signed in as …" indicator present on /dashboard: ${r.signedInIndicatorFound ? 'yes' : 'NO'}`
          : `\n- "Signed in as …" indicator present on /dashboard: ${r.signedInIndicatorFound ? 'yes' : 'NO'}`),
    );
    lines.push('');
    lines.push('**Role-access / reachability:**');
    lines.push('');
    lines.push('| Route | Reachable |');
    lines.push('|---|---|');
    for (const route of r.routes) {
      lines.push(`| ${route.route} | ${route.reachable ? 'YES' : 'NO'} |`);
    }
    lines.push('');

    for (const route of r.routes) {
      lines.push(`### ${route.route} — ${route.screen}`);
      lines.push('');
      if (route.error) {
        lines.push(`_Snapshot error: ${route.error}_`);
        lines.push('');
        continue;
      }
      lines.push('| Contract element (role + accessible name) | Status |');
      lines.push('|---|---|');
      for (const res of route.results) {
        const lvl = res.level ? ` (level ${res.level})` : '';
        const mark = res.status === 'FOUND' ? 'FOUND' : '**MISSING**';
        lines.push(`| ${res.role} "${res.name}"${lvl} | ${mark} |`);
      }
      lines.push('');
      if (route.undocumented.length) {
        lines.push('**Undocumented (live, not in contract):**');
        lines.push('');
        for (const u of route.undocumented) {
          lines.push(`- ${u.role} "${u.name}" (${u.ref})`);
        }
        lines.push('');
      } else {
        lines.push('_No undocumented interactive elements._');
        lines.push('');
      }
    }

    lines.push('**Flow-only routes (skipped — require mid-flow state):**');
    lines.push('');
    for (const f of r.flowOnlyRoutes) {
      lines.push(`- ${f.route} — ${f.screen}`);
    }
    lines.push('');
  }

  // MISSING summary across roles.
  const missing = [];
  for (const r of findings.roles) {
    for (const route of r.routes) {
      for (const res of route.results || []) {
        if (res.status === 'MISSING') {
          missing.push(`${r.role} ${route.route}: ${res.role} "${res.name}"`);
        }
      }
    }
  }
  lines.push('## Contract elements unexpectedly MISSING');
  lines.push('');
  if (missing.length === 0) {
    lines.push('_None — every contract element on the walked routes was found._');
  } else {
    for (const m of missing) lines.push(`- ${m}`);
  }
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  mkdirSync(GENERATED, { recursive: true });

  const findings = {
    generatedAt: new Date().toISOString(),
    reactBaseUrl: REACT_BASE,
    agentBrowserNote: 'v0.27 (snapshot -i --json)',
    contract: 'shared/a11y-contract.md',
    roles: [],
  };

  let failure = null;
  try {
    for (const role of ROLES) {
      console.log(`verify: crawling as ${role.username} …`);
      const result = crawlRole(role);
      findings.roles.push(result);
    }
  } catch (err) {
    failure = err?.message || String(err);
    console.error(`\n[verify] crawl failed: ${failure}`);
    console.error(
      '[verify] Ensure the mock API (:4000) and React app (:5173) are running and ' +
        'that `agent-browser` is installed (login shell).\n',
    );
  } finally {
    const closed = ab(['close', '--all']);
    if (!closed.ok) {
      console.error(`[verify] note: agent-browser close --all returned: ${closed.stderr}`);
    }
  }

  if (failure) findings.error = failure;

  writeFileSync(JSON_PATH, JSON.stringify(findings, null, 2) + '\n');
  writeFileSync(REPORT_PATH, md(findings) + '\n');

  console.log(`verify: wrote ${JSON_PATH}`);
  console.log(`verify: wrote ${REPORT_PATH}`);

  // Console summary of the headline finding.
  const debtCount = findings.roles
    .flatMap((r) => r.routes)
    .flatMap((rt) => rt.a11yDebt || []).length;
  const toggleCaught = findings.roles
    .flatMap((r) => r.routes)
    .flatMap((rt) => rt.a11yDebt || [])
    .some((d) => d.likelyMenuToggle);
  console.log(
    `verify: a11y/locator debt nodes flagged: ${debtCount} ` +
      `(menu toggle defect caught: ${toggleCaught ? 'YES' : 'NO'})`,
  );

  if (failure) process.exitCode = 1;
}

main();
