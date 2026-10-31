// Runs ONLY in the "demo-enabled" project, against a development server started with
// VITE_ENABLE_DEMO_PERSONAS=true (see playwright.config.js). Proves that the developer demo screens
// work when explicitly enabled, and that even then they authenticate nobody and call no sign-in API.
import { test, expect } from '@playwright/test';
import { mockApi, open } from './helpers/mockApi';

test.describe('developer demo screens (explicitly enabled)', () => {
  let api;
  test.beforeEach(async ({ page }) => {
    api = await mockApi(page);
  });

  test('are offered, are clearly labelled, and open the sample screens without signing anyone in', async ({ page }) => {
    await open(page, '/login');
    const section = page.locator('.demo-persona-section');
    await expect(section).toContainText('Development only');
    await expect(section).toContainText('Nothing here is authenticated');

    await section.getByRole('button', { name: 'Sample admin screens' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.locator('.adm-brand')).toContainText('Salvex Admin');
    await expect(page.getByText('Demo screens, not signed in')).toBeVisible();

    // no sign-in call was made, and the backend still considers the visitor anonymous
    expect(api.callsTo('POST', '/api/auth/login')).toHaveLength(0);
    expect(api.state.user).toBeNull();
    await expect(page.locator('#nav-user-chip')).toHaveCount(0);
  });

  test('do not survive a reload and never touch browser storage', async ({ page }) => {
    await open(page, '/login');
    await page.locator('.demo-persona-section').getByRole('button', { name: 'Sample seller screens' }).click();
    await expect(page).toHaveURL(/\/seller\/dashboard$/);
    const stored = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
    expect(stored).toEqual({ local: [], session: [] });

    await page.reload();
    await expect(page).toHaveURL(/\/login$/);                 // back to the sign-in page: nothing persisted
  });
});
