import { test, expect } from '@playwright/test';
import { mockApi, isExpectedAnonymousProbe, USERS } from './helpers/mockApi';

function attachConsoleAndAssetListeners(page, allowedWarnings = []) {
  const errors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Asking who is signed in while nobody is gives a normal 401; the browser logs it as a resource error.
      const isAllowed = text.includes('status of 401') || allowedWarnings.some((w) => text.includes(w));
      if (!isAllowed) {
        errors.push(`Console error: ${text}`);
      }
    }
  });

  page.on('pageerror', (err) => {
    errors.push(`Page error: ${err.message}`);
  });

  page.on('response', (response) => {
    const url = response.url();
    // Only fail on local 4xx/5xx responses (ignore external unsplash fallback network quirks if any)
    if (url.includes('localhost:5173') && response.status() >= 400 && !isExpectedAnonymousProbe(response)) {
      errors.push(`Failed local asset (${response.status()}): ${url}`);
    }
  });

  return errors;
}

test.describe('Phase 1 Smoke & Route Tests', () => {
  // The website asks the backend who is signed in on every page load; answer it without a real backend.
  let api;
  test.beforeEach(async ({ page }) => {
    api = await mockApi(page);
  });

  const routesToTest = [
    { path: '/', titleExpected: 'Salvex' },
    { path: '/auctions/ended', headingText: 'Ended' },
    { path: '/spare-parts', headingText: 'Spare parts' },
    { path: '/ready-to-lift', headingText: 'Ready to Lift' },
    { path: '/auctions/live', headingText: 'Live' },
    { path: '/auctions/upcoming', headingText: 'Upcoming' },
    { path: '/how-it-works', headingText: 'How' },
    { path: '/bidding-rules', headingText: 'Rules' },
    { path: '/about', headingText: 'About' },
    { path: '/contact', headingText: 'Contact' },
    { path: '/faq', headingText: 'FAQ' },
    { path: '/legal', headingText: 'Terms' },
    { path: '/legal/terms', headingText: 'Terms' },
    { path: '/legal/privacy', headingText: 'Privacy' },
    { path: '/legal/refund', headingText: 'Refund' },
    { path: '/services/insurance', headingText: 'Insurance' },
    { path: '/services/recovery', headingText: 'Recovery' },
    { path: '/services/documentation', headingText: 'Documentation' },
    { path: '/login', headingText: 'Sign In' },
  ];

  for (const { path } of routesToTest) {
    test(`Route ${path} loads without console errors or failed local assets`, async ({ page }) => {
      const errors = attachConsoleAndAssetListeners(page);
      await page.goto(path);
      // Wait for app root or body to be visible
      await expect(page.locator('#main-content')).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test('404 Page renders for unknown routes with button to return home', async ({ page }) => {
    const errors = attachConsoleAndAssetListeners(page);
    await page.goto('/unknown-nonexistent-route-404');
    await expect(page.locator('text=Page Not Found')).toBeVisible();
    await expect(page.locator('text=Return to Homepage')).toBeVisible();
    await page.click('text=Return to Homepage');
    await expect(page).toHaveURL('http://localhost:5173/');
    expect(errors).toEqual([]);
  });

  test('/vehicles/:id for an unknown vehicle shows a friendly message, not a crash', async ({ page }) => {
    const errors = [];                       // the 404 from the API is expected here; only crashes count
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/vehicles/00000000-0000-4000-8000-000000000000');
    await expect(page.locator('#main-content')).toBeVisible();
    await expect(page.getByText(/not found|not available|could not/i).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('/payment/invalid redirects to /dashboard (or /login if not authenticated)', async ({ page }) => {
    const errors = attachConsoleAndAssetListeners(page);
    await page.goto('/payment/invalid-lot-id');
    // Without auth, protected route redirects to /login; with auth, invalid lot redirects to /dashboard
    await expect(page).toHaveURL(/(\/login|\/dashboard)/);
    expect(errors).toEqual([]);
  });

  test('A signed-in bidder cannot open /admin and is sent to their own dashboard', async ({ page }) => {
    const errors = attachConsoleAndAssetListeners(page);
    api.signIn(USERS.bidder);
    await page.goto('/admin');
    // The role comes from the backend (GET /api/auth/me); a bidder is not allowed in /admin
    await expect(page).toHaveURL(/.*\/dashboard/);
    expect(errors).toEqual([]);
  });

  test('A signed-in admin can open /admin and stays signed in after a reload', async ({ page }) => {
    const errors = attachConsoleAndAssetListeners(page);
    api.signIn(USERS.admin);
    await page.goto('/admin');
    await expect(page.locator('.adm-brand strong')).toHaveText('Salvex Admin');

    await page.reload();
    await expect(page).toHaveURL(/.*\/admin/);
    await expect(page.locator('.adm-brand strong')).toHaveText('Salvex Admin');
    expect(errors).toEqual([]);
  });
});
