import { test, expect, request } from '@playwright/test';
import { z } from 'zod';

const BASE_URL = 'http://localhost:4000';

// --- Zod Schemas ---
const AccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  balance: z.number(),
});

const AccountsListSchema = z.array(AccountSchema);

test.describe('accounts', () => {
  let apiContext: Awaited<ReturnType<typeof request.newContext>>;
  let token: string;

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
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('GET /api/accounts → 200 returns array of accounts', async () => {
    const res = await apiContext.get('/api/accounts', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    AccountsListSchema.parse(body);
  });
});
