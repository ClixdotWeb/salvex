import { test, expect } from '@playwright/test';
import { mockApi, USERS, CSRF, open } from './helpers/mockApi';

// On a phone the account controls live in the menu drawer.
test.describe('signed-in state in the mobile menu', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile layout only');

  let api;
  test.beforeEach(async ({ page }) => {
    api = await mockApi(page);
  });

  test('a signed-in user sees their account and a working sign out in the drawer', async ({ page }) => {
    api.signIn(USERS.seller);
    await open(page, '/');
    await page.click('#mobile-nav-hamburger');
    const drawer = page.getByLabel('Mobile Navigation');
    await expect(drawer.getByRole('button', { name: /My account \(Sunil\)/ })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Register as Bidder' })).toHaveCount(0);

    await drawer.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.locator('.salvex-toast-notification')).toContainText('You have been signed out.');
    expect(api.callsTo('POST', '/api/auth/logout')[0].headers['x-csrf-token']).toBe(CSRF);

    await page.click('#mobile-nav-hamburger');
    await expect(drawer.getByRole('button', { name: 'Register as Bidder' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: /My account/ })).toHaveCount(0);
  });

  test('"My account" takes each role to its own home', async ({ page }) => {
    api.signIn(USERS.admin);
    await open(page, '/');
    await page.click('#mobile-nav-hamburger');
    await page.getByLabel('Mobile Navigation').getByRole('button', { name: /My account/ }).click();
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('an anonymous visitor in the drawer is offered login and registration, and Register opens the sign-up page', async ({ page }) => {
    await open(page, '/');
    await page.click('#mobile-nav-hamburger');
    const drawer = page.getByLabel('Mobile Navigation');
    await expect(drawer.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
    await drawer.getByRole('button', { name: 'Register as Bidder' }).click();
    await expect(page).toHaveURL(/\/register$/);
  });
});
