import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';

// PROOF SPEC for the dedicated runner package.
//
// This spec lives OUTSIDE steel-thread/thread (under runner/example/). It is a
// verbatim copy of the generated
//   steel-thread/thread/out/orangehrm/login-happy-path/login-happy-path.spec.ts
// and resolves `@playwright/test` from runner/node_modules — demonstrating that
// a generated spec no longer has to live under steel-thread/thread to run.
//
// Driven by runner/playwright.example.config.ts, which hardcodes the orangehrm
// live baseURL for this proof (no profile needed).

test.describe('Admin logs in and reaches the dashboard', () => {
  test('Admin successfully logs in and sees the Dashboard', async ({ page }) => {
    const loginPage = new LoginPage(page);

    // Navigate to the login page
    await page.goto('/web/index.php/auth/login');

    // Step 1: Sign in as Admin
    await loginPage.fillUsername('Admin');
    await loginPage.fillPassword('admin123');
    await loginPage.clickLogin();

    // Assert: Dashboard heading is visible after login (state change caused by Login click)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 });
  });
});
