#!/usr/bin/env node
/**
 * trace_compiler.mjs — steel-thread trace → Playwright compiler.
 *
 * Reads generated/trace.*.json (produced by discover.mjs) and freezes the
 * demonstrated journey into THREE deterministic artifacts in generated/:
 *
 *   - analyst-transfer.feature      Gherkin named from the trace intents.
 *   - pages/*.ts                    Playwright Page Objects, one per screen,
 *                                   located by ROLE + ACCESSIBLE NAME only.
 *   - analyst-transfer.spec.ts      @playwright/test spec that walks the journey
 *                                   via the page objects and applies the
 *                                   ASSERTION BAR (assertion-bar.md): it asserts
 *                                   the state change the Confirm click CAUSED.
 *
 * Two modes:
 *   - If the model gateway is reachable: POST the trace to it (provider-agnostic;
 *     the gateway maps the `reasoning` tier to a provider+model with strict tool
 *     use / structured output). The compiler holds NO provider key — credential
 *     isolation lives in the gateway (plan Rule 6 / §21.4). Set QA_GATEWAY_URL to
 *     override the default http://localhost:4100.
 *   - If the gateway is unreachable or errors: emit a correct, hand-written
 *     ("deterministic fallback") version of all three artifacts so the runner
 *     still works offline. A clear note is printed either way.
 *
 * The generated .spec.ts is runnable under @playwright/test regardless of mode.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProfile } from '../../toolkit/profile.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const GENERATED = join(__dirname, 'generated');
const PAGES_DIR = join(GENERATED, 'pages');

const profile = loadProfile();
const GATEWAY_URL = profile.gateway.url;
// NOTE (next increment): CONTRACT_FACTS below + the journey selection are still
// FundFlow-specific. Generalising them from profile.contract + profile.journeys
// is what makes compile-from-scratch work for a new target app.

// ---------------------------------------------------------------------------
// Load the trace
// ---------------------------------------------------------------------------

function loadTrace() {
  let files = [];
  try {
    files = readdirSync(GENERATED).filter((f) => /^trace\..*\.json$/.test(f));
  } catch {
    files = [];
  }
  if (files.length === 0) {
    throw new Error(
      `No generated/trace.*.json found. Run \`node discover.mjs\` first ` +
        `(it writes a reference trace even with no live browser).`,
    );
  }
  // Prefer the analyst-transfer trace if present.
  const chosen =
    files.find((f) => f.includes('analyst-transfer')) || files.sort()[0];
  const path = join(GENERATED, chosen);
  const trace = JSON.parse(readFileSync(path, 'utf8'));
  return { trace, path: chosen };
}

// ---------------------------------------------------------------------------
// Deterministic artifact generators (also the fallback when no API key).
// These are derived purely from the trace + the contract, so they are correct
// and runnable without any model call.
// ---------------------------------------------------------------------------

function featureFromTrace(trace) {
  const lines = [];
  lines.push(`Feature: ${trace.title}`);
  lines.push(`  # Compiled from trace ${trace.journeyId} (source: ${trace.source}).`);
  lines.push(`  # Authoritative accessible names: ${trace.contract}`);
  lines.push('');
  lines.push(`  Scenario: ${trace.title}`);

  const kw = (i) => (i === 0 ? 'Given' : 'When');
  trace.steps.forEach((step, i) => {
    lines.push(`    ${i === 0 ? 'Given' : 'When'} ${lowerFirst(step.intent)}`);
  });
  // Then: the assertion bar — the caused state change.
  lines.push('    Then the receipt heading "Transfer Complete" is shown');
  lines.push('    And a populated "Transaction ID:" is present');
  lines.push('');
  return lines.join('\n');
}

function lowerFirst(s) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

// --- Page Objects -----------------------------------------------------------
// One file per screen. Locators are role + accessible name ONLY.

function pageObjects() {
  const login = `import { Page, Locator } from '@playwright/test';

/** /login — Sign in to FundFlow. Locators: role + accessible name only. */
export class LoginPage {
  constructor(private readonly page: Page) {}

  heading(): Locator {
    return this.page.getByRole('heading', { level: 1, name: 'Sign in to FundFlow' });
  }
  username(): Locator {
    return this.page.getByLabel('Username');
  }
  password(): Locator {
    return this.page.getByLabel('Password');
  }
  signInButton(): Locator {
    return this.page.getByRole('button', { name: 'Sign in' });
  }

  async signIn(username: string, password: string): Promise<void> {
    await this.username().fill(username);
    await this.password().fill(password);
    await this.signInButton().click();
  }
}
`;

  const dashboard = `import { Page, Locator } from '@playwright/test';

/** /dashboard. Locators: role + accessible name only. */
export class DashboardPage {
  constructor(private readonly page: Page) {}

  heading(): Locator {
    return this.page.getByRole('heading', { level: 1, name: 'Dashboard' });
  }
  initiateTransferButton(): Locator {
    return this.page.getByRole('button', { name: 'Initiate Transfer' });
  }

  async initiateTransfer(): Promise<void> {
    await this.initiateTransferButton().click();
  }
}
`;

  const transfer = `import { Page, Locator } from '@playwright/test';

/** /transfer — Initiate Transfer. Locators: role + accessible name only. */
export class TransferPage {
  constructor(private readonly page: Page) {}

  heading(): Locator {
    return this.page.getByRole('heading', { level: 1, name: 'Initiate Transfer' });
  }
  fromAccount(): Locator {
    return this.page.getByLabel('From account');
  }
  payee(): Locator {
    return this.page.getByLabel('Payee');
  }
  amount(): Locator {
    return this.page.getByLabel('Amount');
  }
  memo(): Locator {
    return this.page.getByLabel('Memo');
  }
  continueButton(): Locator {
    return this.page.getByRole('button', { name: 'Continue to review' });
  }

  async fillTransfer(input: {
    fromAccount: string;
    payee: string;
    amount: string;
    memo?: string;
  }): Promise<void> {
    await this.fromAccount().selectOption({ label: input.fromAccount });
    await this.payee().selectOption({ label: input.payee });
    await this.amount().fill(input.amount);
    if (input.memo !== undefined) {
      await this.memo().fill(input.memo);
    }
    await this.continueButton().click();
  }
}
`;

  const review = `import { Page, Locator } from '@playwright/test';

/** /transfer/review — Review & Confirm. Locators: role + accessible name only. */
export class ReviewPage {
  constructor(private readonly page: Page) {}

  heading(): Locator {
    return this.page.getByRole('heading', { level: 1, name: 'Review & Confirm' });
  }
  amountSummary(formatted: string): Locator {
    // e.g. "Amount: $2,500.00"
    return this.page.getByText(\`Amount: \${formatted}\`);
  }
  confirmButton(): Locator {
    return this.page.getByRole('button', { name: 'Confirm transfer' });
  }
  backButton(): Locator {
    return this.page.getByRole('button', { name: 'Back' });
  }

  /** The money gate. */
  async confirm(): Promise<void> {
    await this.confirmButton().click();
  }
}
`;

  const receipt = `import { Page, Locator } from '@playwright/test';

/** /transfer/receipt/:id — Receipt. Locators: role + accessible name only. */
export class ReceiptPage {
  constructor(private readonly page: Page) {}

  /** The caused-state-change heading (assertion-bar.md). */
  heading(): Locator {
    return this.page.getByRole('heading', { level: 1, name: 'Transfer Complete' });
  }
  /** A *populated* transaction id — label followed by a non-empty value. */
  transactionId(): Locator {
    return this.page.getByText(/Transaction ID:\\s*\\S+/);
  }
  backToDashboardButton(): Locator {
    return this.page.getByRole('button', { name: 'Back to dashboard' });
  }
}
`;

  return {
    'login.page.ts': login,
    'dashboard.page.ts': dashboard,
    'transfer.page.ts': transfer,
    'review.page.ts': review,
    'receipt.page.ts': receipt,
  };
}

// --- Spec -------------------------------------------------------------------

function specFromTrace(trace) {
  return `import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/login.page';
import { DashboardPage } from './pages/dashboard.page';
import { TransferPage } from './pages/transfer.page';
import { ReviewPage } from './pages/review.page';
import { ReceiptPage } from './pages/receipt.page';

/**
 * Compiled from trace ${trace.journeyId} (source: ${trace.source}).
 * The SAME spec runs against the React (:5173) and Angular (:4200) builds —
 * that identical run is the experiment. Locators are role + accessible name
 * only, so they are framework-independent (${trace.contract}).
 *
 * Assertion bar (assertion-bar.md): the final assertions check the state change
 * the "Confirm transfer" click CAUSED — the receipt heading and a populated
 * Transaction ID — NOT merely that the receipt route loaded.
 */
test('${trace.title.replace(/'/g, "\\'")}', async ({ page }) => {
  const login = new LoginPage(page);
  const dashboard = new DashboardPage(page);
  const transfer = new TransferPage(page);
  const review = new ReviewPage(page);
  const receipt = new ReceiptPage(page);

  // 1. /login — sign in as the analyst (synthetic creds, Rule 7).
  await page.goto('/login');
  await login.signIn('analyst', 'demo1234');

  // 2. /dashboard — land and start a transfer.
  await expect(dashboard.heading()).toBeVisible();
  await dashboard.initiateTransfer();

  // 3. /transfer — fill details and continue to review.
  await expect(transfer.heading()).toBeVisible();
  await transfer.fillTransfer({
    fromAccount: 'Operating',
    payee: 'Acme Supplies',
    amount: '2500',
    memo: 'Q2 invoice',
  });

  // 4. /transfer/review — verify the summary, then confirm (the money gate).
  await expect(review.heading()).toBeVisible();
  await expect(review.amountSummary('$2,500.00')).toBeVisible();
  await review.confirm();

  // 5. /transfer/receipt/:id — THE ASSERTION BAR.
  // Assert the state change the Confirm click CAUSED, not just the route.
  await expect(receipt.heading()).toBeVisible();          // "Transfer Complete"
  await expect(receipt.transactionId()).toBeVisible();    // populated "Transaction ID: ..."
});
`;
}

function deterministicArtifacts(trace) {
  return {
    feature: featureFromTrace(trace),
    spec: specFromTrace(trace),
    pages: pageObjects(),
  };
}

// ---------------------------------------------------------------------------
// Anthropic SDK path (structured / strict tool use)
// ---------------------------------------------------------------------------

const CONTRACT_FACTS = `Authoritative accessible names (role + accessible name only — never CSS/testid):
- /login: heading L1 "Sign in to FundFlow"; textbox "Username"; textbox "Password"; button "Sign in".
- /dashboard: heading L1 "Dashboard"; button "Initiate Transfer".
- /transfer: heading L1 "Initiate Transfer"; combobox "From account"; combobox "Payee"; textbox "Amount"; textbox "Memo"; button "Continue to review".
- /transfer/review: heading L1 "Review & Confirm"; text "Amount: \$2,500.00"; button "Confirm transfer"; button "Back".
- /transfer/receipt/:id: heading L1 "Transfer Complete"; text "Transaction ID: <id>"; button "Back to dashboard".

Journey values: From account = Operating, Payee = Acme Supplies, Amount = 2500 (renders "Amount: \$2,500.00"), Memo = Q2 invoice. Login analyst / demo1234.

THE ASSERTION BAR (mandatory): the spec MUST assert at least one state change the "Confirm transfer" click CAUSED — the receipt heading "Transfer Complete" AND a populated "Transaction ID:" (label followed by a non-empty value, asserted by pattern /Transaction ID:\\s*\\S+/). Asserting only the URL/route is NOT acceptable.

Rules: Playwright @playwright/test. Locate ONLY by role + accessible name (getByRole / getByLabel / getByText). One Page Object class per screen. The spec must be valid, runnable TypeScript and use page.goto('/login') with a relative path (baseURL is provided by playwright.config.ts).`;

const TOOL = {
  name: 'emit_artifacts',
  description:
    'Emit the three compiled Playwright artifacts for the journey.',
  input_schema: {
    type: 'object',
    properties: {
      feature: { type: 'string', description: 'The Gherkin .feature file contents.' },
      spec: {
        type: 'string',
        description:
          'The analyst-transfer.spec.ts contents. Imports page objects from ./pages/*.',
      },
      pages: {
        type: 'array',
        description: 'One Page Object file per screen.',
        items: {
          type: 'object',
          properties: {
            filename: {
              type: 'string',
              description: 'e.g. login.page.ts (no directory prefix).',
            },
            contents: { type: 'string' },
          },
          required: ['filename', 'contents'],
        },
      },
    },
    required: ['feature', 'spec', 'pages'],
  },
};

async function generateViaGateway(trace) {
  const prompt = `You are the steel-thread trace compiler. Compile this recorded journey trace into a Gherkin feature, Playwright Page Objects (one per screen), and a runnable @playwright/test spec. Call emit_artifacts exactly once with all three.

${CONTRACT_FACTS}

Recorded trace (intents + role/name actions + observed api_calls):
${JSON.stringify(trace, null, 2)}`;

  // Provider-agnostic call. No vendor SDK, no key here — the gateway owns both.
  const res = await fetch(`${GATEWAY_URL}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      repo: profile.name,
      tier: 'reasoning',
      messages: [{ role: 'user', content: prompt }],
      tool: TOOL,
      tool_choice: { type: 'tool', name: 'emit_artifacts' },
      max_tokens: 8000,
      payload_types: ['trace', 'contract'], // audited as types only (Rule 6)
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`gateway ${res.status}: ${body.slice(0, 160)}`);
  }
  const data = await res.json();
  const out = data.output;
  if (!out || !out.feature || !out.spec || !Array.isArray(out.pages) || out.pages.length === 0) {
    throw new Error('gateway returned an incomplete artifact set');
  }
  const pages = {};
  for (const p of out.pages) pages[p.filename] = p.contents;
  return { artifacts: { feature: out.feature, spec: out.spec, pages }, meta: { provider: data.provider, model: data.model } };
}

// ---------------------------------------------------------------------------
// Write artifacts
// ---------------------------------------------------------------------------

function writeArtifacts({ feature, spec, pages }) {
  mkdirSync(PAGES_DIR, { recursive: true });
  writeFileSync(join(GENERATED, 'analyst-transfer.feature'), feature.endsWith('\n') ? feature : feature + '\n');
  writeFileSync(join(GENERATED, 'analyst-transfer.spec.ts'), spec.endsWith('\n') ? spec : spec + '\n');
  const written = [];
  for (const [name, contents] of Object.entries(pages)) {
    const path = join(PAGES_DIR, name);
    writeFileSync(path, contents.endsWith('\n') ? contents : contents + '\n');
    written.push(`pages/${name}`);
  }
  return written;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { trace, path } = loadTrace();
  console.log(`compile: read generated/${path} (journey ${trace.journeyId}, source ${trace.source}).`);

  let artifacts;
  let mode;
  try {
    const r = await generateViaGateway(trace);
    artifacts = r.artifacts;
    mode = `gateway (${r.meta.provider}:${r.meta.model})`;
  } catch (err) {
    console.error(`compile: gateway generation unavailable (${err?.message || err}).`);
    console.error('compile: NOTE — falling back to the deterministic hand-written artifacts.');
    console.error(`compile: (start the model gateway at ${GATEWAY_URL} for model-mode compilation.)`);
    artifacts = deterministicArtifacts(trace);
    mode = 'deterministic fallback (gateway unavailable)';
  }

  const written = writeArtifacts(artifacts);
  console.log(`compile: mode = ${mode}`);
  console.log('compile: wrote:');
  console.log('  - generated/analyst-transfer.feature');
  console.log('  - generated/analyst-transfer.spec.ts');
  for (const w of written) console.log(`  - generated/${w}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
