import { test, expect, request } from '@playwright/test';

const BASE_URL = 'http://localhost:4000';

test.describe('test (reset hook)', () => {
  let apiContext: Awaited<ReturnType<typeof request.newContext>>;

  test.beforeAll(async () => {
    apiContext = await request.newContext({ baseURL: BASE_URL });
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('POST /api/reset → 204 resets in-memory state', async () => {
    const res = await apiContext.post('/api/reset');
    expect(res.status()).toBe(204);
    // 204 No Content — no body to validate
  });
});
