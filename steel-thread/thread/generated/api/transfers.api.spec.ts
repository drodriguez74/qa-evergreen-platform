import { test, expect, request } from '@playwright/test';
import { z } from 'zod';

const BASE_URL = 'http://localhost:4000';

// --- Zod Schemas ---
const ReceiptSchema = z.object({
  transactionId: z.string(),
  status: z.enum(['completed']),
  fromAccountId: z.string(),
  payeeId: z.string(),
  amount: z.number(),
  memo: z.string().optional(),
  newBalance: z.number(),
});

const ErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

test.describe('transfers', () => {
  let apiContext: Awaited<ReturnType<typeof request.newContext>>;
  let token: string;
  let fromAccountId: string;
  let payeeId: string;
  let createdTransactionId: string;

  test.beforeAll(async () => {
    apiContext = await request.newContext({ baseURL: BASE_URL });

    // Reset state
    await apiContext.post('/api/reset');

    // Authenticate
    const loginRes = await apiContext.post('/api/login', {
      data: { username: 'analyst', password: 'demo1234' },
    });
    const loginBody = await loginRes.json();
    token = loginBody.token;

    // Discover a real account id
    const accountsRes = await apiContext.get('/api/accounts', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const accounts = await accountsRes.json();
    fromAccountId = accounts[0].id;

    // Discover a real payee id
    const payeesRes = await apiContext.get('/api/payees', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payees = await payeesRes.json();
    payeeId = payees[0].id;
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('POST /api/transfers → 201 creates a transfer and returns receipt', async () => {
    const res = await apiContext.post('/api/transfers', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        fromAccountId,
        payeeId,
        amount: 10,
        memo: 'Playwright test transfer',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    const parsed = ReceiptSchema.parse(body);
    createdTransactionId = parsed.transactionId;
  });

  test('GET /api/transfers/{id} → 200 fetches the created receipt by id', async () => {
    // Ensure we have the transactionId from the prior test
    // (tests within a describe block run in order and share beforeAll scope)
    expect(createdTransactionId).toBeTruthy();

    const res = await apiContext.get(`/api/transfers/${createdTransactionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    ReceiptSchema.parse(body);
  });

  test('GET /api/transfers/{id} → 404 for unknown transfer id', async () => {
    const res = await apiContext.get('/api/transfers/nonexistent-id-00000', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    ErrorSchema.parse(body);
  });

  test('POST /api/transfers → 422 for invalid amount (zero)', async () => {
    const res = await apiContext.post('/api/transfers', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        fromAccountId,
        payeeId,
        amount: 0,
      },
    });
    expect(res.status()).toBe(422);
    const body = await res.json();
    ErrorSchema.parse(body);
  });
});
