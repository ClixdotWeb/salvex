import { test, expect } from '@playwright/test';
import { mockApi, USERS, CSRF, open } from './helpers/mockApi';

// The signed-in indicator lives in the desktop navbar (mobile uses the menu drawer).
test.describe('session restore, signed-in indicator and sign out', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop navbar controls');

  let api;
  test.beforeEach(async ({ page }) => {
    api = await mockApi(page);
  });

  test('anonymous visitors see Register and no signed-in chip', async ({ page }) => {
    await open(page, '/');
    await expect(page.locator('#nav-register-cta')).toBeVisible();
    await expect(page.locator('#nav-user-chip')).toHaveCount(0);
    expect(api.callsTo('GET', '/api/auth/me').length).toBeGreaterThanOrEqual(1);
  });

  test('a signed-in user is restored after a reload using only the backend, with nothing kept in browser storage', async ({ page }) => {
    api.signIn(USERS.bidder);
    await open(page, '/');
    await expect(page.locator('#nav-avatar')).toHaveText('A');
    await expect(page.locator('#nav-avatar')).toHaveAttribute('aria-label', 'My account (Asha)');

    await page.reload();
    await expect(page.locator('#nav-avatar')).toHaveText('A');

    // the avatar opens the account menu: who you are, dashboard, profile and sign out
    await page.locator('#nav-avatar').click();
    const menu = page.getByRole('menu', { name: 'My account' });
    await expect(menu).toContainText('Asha');
    await expect(menu.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'My dashboard' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(menu).toHaveCount(0);

    const stored = await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
      cookie: document.cookie,
    }));
    expect(stored).toEqual({ local: [], session: [], cookie: '' });
  });

  test('browser storage can never make anyone signed in', async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem('salvex_demo_auth', JSON.stringify({ isAuthenticated: true, role: 'admin' }));
      localStorage.setItem('isAuthenticated', 'true');
      localStorage.setItem('role', 'admin');
    });
    await open(page, '/');
    await expect(page.locator('#nav-user-chip')).toHaveCount(0);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
  });

  test('sign out calls the server with the CSRF token, then clears the indicator for good', async ({ page }) => {
    api.signIn(USERS.seller);
    await open(page, '/');
    await page.locator('#nav-avatar').click();
    await page.locator('#nav-signout-btn').click();

    await expect(page.locator('#nav-register-cta')).toBeVisible();
    await expect(page.locator('#nav-user-chip')).toHaveCount(0);
    await expect(page.locator('.salvex-toast-notification')).toContainText('You have been signed out.');

    const [call] = api.callsTo('POST', '/api/auth/logout');
    expect(call.headers['x-csrf-token']).toBe(CSRF);

    await page.reload();
    await expect(page.locator('#nav-user-chip')).toHaveCount(0); // the server really ended the session
  });

  test('if the server cannot be reached the device is still signed out and the person is told', async ({ page }) => {
    api.signIn(USERS.bidder);
    api.override('POST /api/auth/logout', () => 'abort');
    await open(page, '/');
    await page.locator('#nav-avatar').click();
    await page.locator('#nav-signout-btn').click();

    await expect(page.locator('#nav-user-chip')).toHaveCount(0);
    await expect(page.locator('.salvex-toast-notification')).toContainText('could not reach the server');
  });

  test('an expired session is noticed when the tab comes back, and protected pages ask for sign-in', async ({ page }) => {
    await page.clock.install();
    api.signIn(USERS.bidder);
    await open(page, '/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    api.expireSession();                       // the session ends on the server
    await page.clock.fastForward(60_000);      // time passes while the tab is in the background
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText('Your session has ended. Please sign in again.')).toBeVisible();
  });

  test('a brief network problem does not sign a valid session out on screen', async ({ page }) => {
    await page.clock.install();
    api.signIn(USERS.bidder);
    await open(page, '/');
    await expect(page.locator('#nav-user-chip')).toBeVisible();

    api.override('GET /api/auth/me', () => 'abort');
    await page.clock.fastForward(60_000);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(300);
    await expect(page.locator('#nav-user-chip')).toBeVisible();
  });
});
