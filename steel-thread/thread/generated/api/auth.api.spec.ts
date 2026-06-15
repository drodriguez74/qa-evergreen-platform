import { test, expect, request } from '@playwright/test';
import { z } from 'zod';

const BASE_URL = 'http://localhost:4000';

// --- Zod Schemas ---
const LoginResponseSchema = z.object({
  token: z.string(),
  role: z.enum(['analyst', 'supervisor']),
  displayName: z.string(),
  approvalLimit: z.number().nullable().optional(),
});

const ErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

test.describe('auth', () => {
  let apiContext: Awaited<ReturnType<typeof request.newContext>>;

  test.beforeAll(async () => {
    apiContext = await request.newContext({ baseURL: BASE_URL });
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('POST /api/login → 200 with valid credentials', async () => {
    const res = await apiContext.post('/api/login', {
      data: { username: 'analyst', password: 'demo1234' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    LoginResponseSchema.parse(body);
  });

  test('POST /api/login → 401 with invalid credentials', async () => {
    const res = await apiContext.post('/api/login', {
      data: { username: 'analyst', password: 'wrongpassword' },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    ErrorSchema.parse(body);
  });
});
