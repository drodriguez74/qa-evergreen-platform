// FundFlow Mock API
// ------------------------------------------------------------------
// Money-movement mock API for the QA Evergreen steel thread.
// Synthetic data only. In-memory state, seeded from ../shared/fixtures.json
// and resettable via POST /api/reset.
//
// Both the React (http://localhost:5173) and Angular (http://localhost:4200)
// front-ends call this same API.
//
// Plain JavaScript, ESM. Run with: node server.js  (listens on :4000)
// ------------------------------------------------------------------

import express from 'express';
import cors from 'cors';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = join(__dirname, '..', 'shared', 'fixtures.json');
const OPENAPI_PATH = join(__dirname, '..', 'shared', 'openapi.yaml');
const PORT = 4000;

// ------------------------------------------------------------------
// In-memory state
// ------------------------------------------------------------------
// `state` holds the live, mutable copy of the seed data. We deep-clone
// fixtures on every (re)seed so that mutations (transfers decrementing
// balances, appended activity, stored receipts) never leak back into the
// pristine fixtures file or across resets.
let state;

/** (Re)load fixtures from disk into a fresh in-memory state. */
function seedState() {
  const fixtures = JSON.parse(readFileSync(FIXTURES_PATH, 'utf-8'));
  state = {
    users: structuredClone(fixtures.users),
    accounts: structuredClone(fixtures.accounts),
    payees: structuredClone(fixtures.payees),
    recentActivity: structuredClone(fixtures.recentActivity),
    receipts: new Map(), // transactionId -> Receipt
  };
}
seedState();

// ------------------------------------------------------------------
// Token helpers
// ------------------------------------------------------------------
// Tokens are opaque strings of the form `tok_<username>`. We do NOT persist
// a token registry; instead we derive the username from the token and look
// the user up in the current state. This keeps tokens valid across resets
// (the fixtures always contain the same users) and avoids token bookkeeping.
function tokenFor(username) {
  return `tok_${username}`;
}

/** Map a bearer token back to its user object, or null. */
function userForToken(token) {
  if (!token || !token.startsWith('tok_')) return null;
  const username = token.slice('tok_'.length);
  return state.users.find((u) => u.username === username) || null;
}

// ------------------------------------------------------------------
// App setup
// ------------------------------------------------------------------
const app = express();
app.use(express.json());

// CORS: allow the React and Angular dev origins. Authorization + Content-Type
// headers must be permitted so the SPAs can send the bearer token and JSON.
app.use(
  cors({
    origin: ['http://localhost:5173', 'http://localhost:4200'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    methods: ['GET', 'POST', 'OPTIONS'],
  })
);

// Small helper for consistent error envelopes.
function sendError(res, status, code, message) {
  return res.status(status).json({ code, message });
}

// ------------------------------------------------------------------
// Bearer auth middleware
// ------------------------------------------------------------------
// Accepts any non-empty `Authorization: Bearer <token>` whose token maps back
// to a known user. Missing/empty/unknown -> 401. On success, attaches the
// resolved user to req.user so handlers know the role + approvalLimit.
function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1].trim() : '';
  if (!token) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Missing or invalid authorization token');
  }
  const user = userForToken(token);
  if (!user) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Missing or invalid authorization token');
  }
  req.user = user;
  next();
}

// ------------------------------------------------------------------
// Health + spec
// ------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Serve the raw OpenAPI spec straight from the shared file.
app.get('/openapi.yaml', (_req, res) => {
  try {
    const yaml = readFileSync(OPENAPI_PATH, 'utf-8');
    res.type('application/yaml').send(yaml);
  } catch {
    sendError(res, 404, 'NOT_FOUND', 'Spec not found');
  }
});

// ------------------------------------------------------------------
// Test hook: reset
// ------------------------------------------------------------------
app.post('/api/reset', (_req, res) => {
  seedState();
  res.status(204).end();
});

// ------------------------------------------------------------------
// Auth: login
// ------------------------------------------------------------------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = state.users.find(
    (u) => u.username === username && u.password === password
  );
  if (!user) {
    return sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid username or password');
  }
  res.json({
    token: tokenFor(user.username),
    role: user.role,
    displayName: user.displayName,
    approvalLimit: user.approvalLimit, // number for analyst, null for supervisor
  });
});

// ------------------------------------------------------------------
// Accounts + payees
// ------------------------------------------------------------------
app.get('/api/accounts', requireAuth, (_req, res) => {
  res.json(
    state.accounts.map(({ id, name, balance }) => ({ id, name, balance }))
  );
});

app.get('/api/payees', requireAuth, (_req, res) => {
  res.json(state.payees.map(({ id, name }) => ({ id, name })));
});

// Recent activity feed for the dashboard table (both front-ends fetch this).
app.get('/api/activity', requireAuth, (_req, res) => {
  res.json(state.recentActivity);
});

// ------------------------------------------------------------------
// Transfers
// ------------------------------------------------------------------
/** Generate a transaction id like TXN-04217 (5 digits). */
function newTransactionId() {
  const n = Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, '0');
  return `TXN-${n}`;
}

app.post('/api/transfers', requireAuth, (req, res) => {
  const { fromAccountId, payeeId, amount, memo } = req.body || {};
  const user = req.user;

  // Business rules, checked IN THIS ORDER (each is a 422):

  // 1) amount must be a positive, finite number.
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return sendError(res, 422, 'INVALID_AMOUNT', 'Enter a valid amount greater than zero');
  }

  // 2) analysts are capped by their approval limit ($10,000).
  if (user.role === 'analyst' && amount > user.approvalLimit) {
    return sendError(
      res,
      422,
      'OVER_APPROVAL_LIMIT',
      'Amount exceeds your approval limit of $10,000'
    );
  }

  // Resolve the source account (needed for the funds check + debit).
  const account = state.accounts.find((a) => a.id === fromAccountId);

  // 3) cannot move more than the account currently holds.
  //    (A missing account has no available balance, so it fails here too.)
  if (!account || amount > account.balance) {
    return sendError(res, 422, 'INSUFFICIENT_FUNDS', 'Amount exceeds available balance');
  }

  // Success: debit the account, mint a receipt, record activity.
  account.balance = Number((account.balance - amount).toFixed(2));
  const transactionId = newTransactionId();
  const payee = state.payees.find((p) => p.id === payeeId);

  const receipt = {
    transactionId,
    status: 'completed',
    fromAccountId,
    payeeId,
    amount,
    memo: memo ?? '',
    newBalance: account.balance,
  };
  state.receipts.set(transactionId, receipt);

  state.recentActivity.unshift({
    id: transactionId,
    date: new Date().toISOString().slice(0, 10),
    payee: payee ? payee.name : payeeId,
    amount,
    from: fromAccountId,
  });

  res.status(201).json(receipt);
});

app.get('/api/transfers/:id', requireAuth, (req, res) => {
  const receipt = state.receipts.get(req.params.id);
  if (!receipt) {
    return sendError(res, 404, 'NOT_FOUND', 'Transfer not found');
  }
  res.json(receipt);
});

// ------------------------------------------------------------------
// Start
// ------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`FundFlow mock API listening on http://localhost:${PORT}`);
});
