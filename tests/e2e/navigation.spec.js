import { test, expect } from '@playwright/test';
import { mockApi, isExpectedAnonymousProbe, USERS } from './helpers/mockApi';

let api;

function attachConsoleAndAssetListeners(page) {
  const errors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Asking who is signed in while nobody is gives a normal 401; the browser logs it as a resource error.
      if (!text.includes('status of 401')) errors.push(`Console error: ${text}`);
    }
  });

  page.on('pageerror', (err) => {
    errors.push(`Page error: ${err.message}`);
  });

  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('localhost:5173') && response.status() >= 400 && !isExpectedAnonymousProbe(response)) {
      errors.push(`Failed local asset (${response.status()}): ${url}`);
    }
  });

  return errors;
}

// The start-up loader covers the page (and blocks clicks) for a few seconds.
async function openAndWait(page, path) {
  await page.goto(path);
  await expect(page.locator('#main-content')).toBeVisible();
  await expect(page.locator('.salvex-page-loader')).toHaveCount(0, { timeout: 20000 });
}

test.describe('Navigation and Site Structure (Phase 1)', () => {
  // The website asks the backend who is signed in on every page load; answer it without a real backend.
  test.beforeEach(async ({ page }) => {
    api = await mockApi(page);
  });

  test.describe('Desktop Navigation Dropdowns', () => {
    test.beforeEach(async ({ page, isMobile }) => {
      test.skip(isMobile, 'Desktop only test suite');
    });

    test('Live and Upcoming auction dropdowns navigate to all sub items and close on Escape and outside click', async ({ page }) => {
      const errors = attachConsoleAndAssetListeners(page);
      await openAndWait(page, '/');

      // 1. Hover opens the dropdown with the categories only
      await page.hover('#nav-link-live-auctions');
      await expect(page.locator('#nav-subitem-live-insurance')).toBeVisible();
      await expect(page.locator('#nav-subitem-live-bank')).toBeVisible();
      await expect(page.locator('#nav-subitem-live-used')).toBeVisible();
      await expect(page.locator('#nav-item-all-live-auctions')).toHaveCount(0);
      await expect(page.locator('#nav-subitem-live-parts')).toHaveCount(0);

      // 2. Escape closes dropdown
      await page.keyboard.press('Escape');
      await expect(page.locator('#nav-subitem-live-insurance')).not.toBeVisible();

      // 3. Reopen and outside click closes dropdown
      await page.mouse.move(640, 400);
      await page.hover('#nav-link-live-auctions');
      await expect(page.locator('#nav-subitem-live-insurance')).toBeVisible();
      await page.mouse.click(10, 10);
      await expect(page.locator('#nav-subitem-live-insurance')).not.toBeVisible();

      // 4. Clicking the main button opens all live auctions
      await page.click('#nav-link-live-auctions');
      await expect(page).toHaveURL(/.*\/auctions\/live$/);
      await expect(page.locator('#nav-link-live-auctions')).toHaveClass(/nav-link-active/);

      // 5. Same for upcoming
      await page.mouse.move(640, 400);
      await page.click('#nav-link-upcoming-auctions');
      await expect(page).toHaveURL(/.*\/auctions\/upcoming$/);
      await expect(page.locator('#nav-link-upcoming-auctions')).toHaveClass(/nav-link-active/);

      expect(errors).toEqual([]);
    });

    test('Category sub-items filter the auction list by category', async ({ page }) => {
      const errors = attachConsoleAndAssetListeners(page);
      await openAndWait(page, '/');

      await page.hover('#nav-link-live-auctions');
      await page.click('#nav-subitem-live-insurance');
      await expect(page).toHaveURL(/\/auctions\/live\?category=insurance$/);
      await expect(page.locator('h1')).toContainText('Insurance auctions');
      await expect(page.locator('[data-testid="category-tab-insurance"]')).toHaveClass(/active/);
      await expect.poll(() => api.calls.some((c) => c.path === '/api/auctions' && c.query.includes('category=insurance'))).toBe(true);

      await page.mouse.move(640, 400);
      await page.hover('#nav-link-upcoming-auctions');
      await page.click('#nav-subitem-upcoming-bank');
      await expect(page).toHaveURL(/\/auctions\/upcoming\?category=bank-nbfc$/);
      await expect(page.locator('h1')).toContainText('Bank / NBFC auctions');

      // Chips change the category; "All categories" clears it; the phase tabs keep it
      await page.click('[data-testid="category-tab-used-vehicle"]');
      await expect(page).toHaveURL(/\/auctions\/upcoming\?category=used-vehicle$/);
      await page.getByRole('tab', { name: 'Live now' }).click();
      await expect(page).toHaveURL(/\/auctions\/live\?category=used-vehicle$/);
      await page.click('[data-testid="category-tab-all"]');
      await expect(page).toHaveURL(/\/auctions\/live$/);

      expect(errors).toEqual([]);
    });

    test('Our Services dropdown navigates to all 4 service items', async ({ page }) => {
      const errors = attachConsoleAndAssetListeners(page);
      await openAndWait(page, '/');

      // 1. Open Our Services
      await page.mouse.move(640, 400);
      await page.hover('#nav-link-services');
      await expect(page.locator('#nav-service-insurance')).toBeVisible();
      await expect(page.locator('#nav-service-recovery')).toBeVisible();
      await expect(page.locator('#nav-service-sell')).toHaveCount(0);          // only admins add vehicles
      await expect(page.locator('#nav-service-documentation')).toBeVisible();

      // 2. Navigate to Insurance Service
      await page.click('#nav-service-insurance');
      await expect(page).toHaveURL(/.*\/services\/insurance/);
      await expect(page.locator('h1')).toContainText('Vehicle Insurance');
      await expect(page.locator('#nav-link-services')).toHaveClass(/nav-link-active/);

      // 3. Navigate to Recovery Service
      await page.mouse.move(640, 400);
      await page.hover('#nav-link-services');
      await page.click('#nav-service-recovery');
      await expect(page).toHaveURL(/.*\/services\/recovery/);
      await expect(page.locator('h1')).toContainText('Recovery Vehicle Booking');
      await expect(page.locator('#nav-link-services')).toHaveClass(/nav-link-active/);

      // 5. Navigate to Documentation Assistance
      await page.mouse.move(640, 400);
      await page.hover('#nav-link-services');
      await page.click('#nav-service-documentation');
      await expect(page).toHaveURL(/.*\/services\/documentation/);
      await expect(page.locator('h1')).toContainText('Vehicle Documentation Assistance');
      await expect(page.locator('#nav-link-services')).toHaveClass(/nav-link-active/);

      expect(errors).toEqual([]);
    });

    test('Spare Parts top-level link navigates and highlights correctly', async ({ page }) => {
      const errors = attachConsoleAndAssetListeners(page);
      await openAndWait(page, '/');

      await page.click('#nav-link-spare-parts');
      await expect(page).toHaveURL(/.*\/spare-parts/);
      await expect(page.locator('h1')).toContainText('Spare parts');
      await expect(page.locator('#nav-link-spare-parts')).toHaveClass(/nav-link-active/);

      expect(errors).toEqual([]);
    });

    test('Ready to Lift link opens the public list with the client note', async ({ page }) => {
      const errors = attachConsoleAndAssetListeners(page);
      await openAndWait(page, '/');
      await page.click('#nav-link-ready-to-lift');
      await expect(page).toHaveURL(/\/ready-to-lift$/);
      await expect(page.locator('h1')).toContainText('Ready to Lift');
      await expect(page.locator('#nav-link-ready-to-lift')).toHaveClass(/nav-link-active/);
      await expect(page.locator('.pub-rtl-note')).toContainText('immediate collection');
      await expect(page.getByText('No Ready to Lift vehicles right now')).toBeVisible();
      expect(errors).toEqual([]);
    });
  });

  test.describe('Mobile Navigation Drawer & Accordions', () => {
    test.beforeEach(async ({ page, isMobile }) => {
      test.skip(!isMobile, 'Mobile only test suite');
    });

    test('Mobile drawer opens, toggles accordions and navigates to all new items', async ({ page }) => {
      const errors = attachConsoleAndAssetListeners(page);
      await openAndWait(page, '/');

      // Open Hamburger menu
      await page.click('#mobile-nav-hamburger');
      await expect(page.locator('#mobile-nav-link-live-auctions')).toBeVisible();

      // Toggle Live Auctions accordion
      await page.click('#mobile-nav-link-live-auctions');
      await expect(page.locator('#mobile-nav-subitem-live-insurance')).toBeVisible();
      await expect(page.locator('#mobile-nav-item-all-live-auctions')).toHaveCount(0);

      // Click subitem
      await page.click('#mobile-nav-subitem-live-insurance');
      await expect(page).toHaveURL(/.*\/auctions\/live\?category=insurance$/);

      // Reopen drawer and navigate to Spare Parts
      await page.click('#mobile-nav-hamburger');
      await page.click('#mobile-nav-link-spare-parts');
      await expect(page).toHaveURL(/.*\/spare-parts/);
      await expect(page.locator('h1')).toContainText('Spare parts');

      // Reopen drawer, toggle Services accordion and navigate to Recovery
      await page.click('#mobile-nav-hamburger');
      await page.click('#mobile-nav-link-services');
      await expect(page.locator('#mobile-nav-service-recovery')).toBeVisible();
      await page.click('#mobile-nav-service-recovery');
      await expect(page).toHaveURL(/.*\/services\/recovery/);
      await expect(page.locator('h1')).toContainText('Recovery Vehicle Booking');

      expect(errors).toEqual([]);
    });
  });
});
