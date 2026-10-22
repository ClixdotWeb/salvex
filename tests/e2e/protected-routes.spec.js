import { test, expect } from '@playwright/test';
import { mockApi, USERS, open } from './helpers/mockApi';

const PROTECTED = ['/dashboard', '/seller/dashboard', '/admin', '/payment/won-101', '/lifting/won-101'];

test.describe('protected pages', () => {
  let api;
  test.beforeEach(async ({ page }) => {
    api = await mockApi(page);
  });

  for (const path of PROTECTED) {
    test(`${path} sends an anonymous visitor to sign in`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    });
  }

  test('while the session is being checked nothing private is shown (no flash), then the right page appears', async ({ page }) => {
    api.signIn(USERS.admin);
    api.slowMe(1500);
    await page.goto('/admin');
    await expect(page.getByText('Checking your session…').first()).toBeVisible();
    await expect(page.locator('text=SALVEX COMMAND CENTER')).toHaveCount(0);   // not rendered while loading
    await expect(page.locator('text=SALVEX COMMAND CENTER')).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('an anonymous visitor is never shown the page while the check is pending', async ({ page }) => {
    api.slowMe(1500);
    await page.goto('/dashboard');
    await expect(page.getByText('Checking your session…').first()).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard$/);       // not redirected before the backend has answered
    await expect(page).toHaveURL(/\/login$/, { timeout: 15000 });
  });

  test('roles decide what you can open, using the role the backend reports', async ({ page }) => {
    api.signIn(USERS.seller);
    await page.goto('/seller/dashboard');
    await expect(page).toHaveURL(/\/seller\/dashboard$/);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/seller\/dashboard$/);       // not allowed: sent to their own home
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard$/);              // sellers may use the bidder area

    api.signIn(USERS.bidder);
    await page.goto('/seller/dashboard');
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('an admin can open every area and stays there after a reload', async ({ page }) => {
    api.signIn(USERS.admin);
    for (const path of ['/admin', '/seller/dashboard', '/dashboard']) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path.replace('/', '\\/')}$`));
    }
    await page.goto('/admin');
    await page.reload();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.locator('text=SALVEX COMMAND CENTER')).toBeVisible();
  });

  test('there are no redirect loops: the address settles and stays put', async ({ page }) => {
    for (const path of PROTECTED) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
      const settled = page.url();
      await page.waitForTimeout(400);
      expect(page.url()).toBe(settled);
    }
  });

  test('the old browser-storage flag grants nothing, even when set to admin', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('salvex_demo_auth', JSON.stringify({ isAuthenticated: true, role: 'admin' })));
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login$/);
    await open(page, '/login');
    await expect(page.locator('main')).not.toContainText('Instant Demo Persona');
  });

  test('the demo screens are not offered by default', async ({ page }) => {
    await open(page, '/login');
    await expect(page.locator('.demo-persona-section')).toHaveCount(0);
  });
});
