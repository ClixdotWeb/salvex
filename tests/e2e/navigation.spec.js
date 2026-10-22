import { test, expect } from '@playwright/test';
import { mockApi, isExpectedAnonymousProbe } from './helpers/mockApi';

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
    await mockApi(page);
  });

  test.describe('Desktop Navigation Dropdowns', () => {
    test.beforeEach(async ({ page, isMobile }) => {
      test.skip(isMobile, 'Desktop only test suite');
    });

    test('Live and Upcoming auction dropdowns navigate to all sub items and close on Escape and outside click', async ({ page }) => {
      const errors = attachConsoleAndAssetListeners(page);
      await openAndWait(page, '/');

      // 1. Open the Live Auctions dropdown (it opens on hover)
      await page.hover('#nav-link-live-auctions');
      await expect(page.locator('#nav-item-all-live-auctions')).toBeVisible();
      await expect(page.locator('#nav-subitem-live-insurance')).toBeVisible();

      // 2. Escape closes dropdown
      await page.keyboard.press('Escape');
      await expect(page.locator('#nav-item-all-live-auctions')).not.toBeVisible();

      // 3. Reopen and outside click closes dropdown
      await page.mouse.move(640, 400);
      await page.hover('#nav-link-live-auctions');
      await expect(page.locator('#nav-item-all-live-auctions')).toBeVisible();
      await page.mouse.click(10, 10);
      await expect(page.locator('#nav-item-all-live-auctions')).not.toBeVisible();

      // 4. Navigate to Insurance Auctions sub item
      await page.hover('#nav-link-live-auctions');
      await page.click('#nav-subitem-live-insurance');
      await expect(page).toHaveURL(/.*\/auctions\/live\?category=insurance/);
      await expect(page.locator('#nav-link-live-auctions')).toHaveClass(/nav-link-active/);

      // 5. Navigate to Used Spare Parts sub item in Upcoming
      await page.mouse.move(640, 400);
      await page.hover('#nav-link-upcoming-auctions');
      await expect(page.locator('#nav-item-all-upcoming-auctions')).toBeVisible();
      await page.click('#nav-subitem-upcoming-parts');
      await expect(page).toHaveURL(/.*\/auctions\/upcoming\?category=used-spare-parts/);
      await expect(page.locator('#nav-link-upcoming-auctions')).toHaveClass(/nav-link-active/);

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
      await expect(page.locator('#nav-service-sell')).toBeVisible();
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

      // 4. Navigate to Sell Your Vehicle (/sell)
      await page.mouse.move(640, 400);
      await page.hover('#nav-link-services');
      await page.click('#nav-service-sell');
      await expect(page).toHaveURL(/.*\/sell/);
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

    test('Ready to Lift top-level link navigates and highlights correctly', async ({ page }) => {
      const errors = attachConsoleAndAssetListeners(page);
      await page.goto('/');

      await page.click('#nav-link-ready-to-lift');
      await expect(page).toHaveURL(/.*\/ready-to-lift/);
      await expect(page.locator('h1')).toContainText('Ready to Lift');
      await expect(page.locator('#nav-link-ready-to-lift')).toHaveClass(/nav-link-active/);

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

      // Click subitem
      await page.click('#mobile-nav-subitem-live-insurance');
      await expect(page).toHaveURL(/.*\/auctions\/live\?category=insurance/);

      // Reopen drawer and navigate to Ready to Lift
      await page.click('#mobile-nav-hamburger');
      await page.click('#mobile-nav-link-ready-to-lift');
      await expect(page).toHaveURL(/.*\/ready-to-lift/);
      await expect(page.locator('h1')).toContainText('Ready to Lift');

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

  test.describe('Category Filter Tabs', () => {
    test('Live Auctions category tabs filter list items properly', async ({ page }) => {
      const errors = attachConsoleAndAssetListeners(page);
      await page.goto('/auctions/live');

      // Click Bank/NBFC category tab
      const bankTab = page.locator('[data-testid="category-tab-bank-nbfc"]');
      await expect(bankTab).toBeVisible();
      await bankTab.click();
      await expect(page).toHaveURL(/.*\/auctions\/live\?category=bank-nbfc/);
      await expect(bankTab).toHaveClass(/active/);

      // Click Used Spare Parts category tab
      const partsTab = page.locator('[data-testid="category-tab-used-spare-parts"]');
      await partsTab.click();
      await expect(page).toHaveURL(/.*\/auctions\/live\?category=used-spare-parts/);
      await expect(partsTab).toHaveClass(/active/);

      // Click Ready to Lift tab
      const readyTab = page.locator('[data-testid="category-tab-ready-to-lift"]');
      await readyTab.click();
      await expect(page).toHaveURL(/.*\/auctions\/live\?category=ready-to-lift/);
      await expect(readyTab).toHaveClass(/active/);

      // Reset to All Lots
      const allTab = page.locator('[data-testid="category-tab-All"]');
      await allTab.click();
      await expect(allTab).toHaveClass(/active/);

      expect(errors).toEqual([]);
    });

    test('Upcoming Auctions category tabs filter list items properly', async ({ page }) => {
      const errors = attachConsoleAndAssetListeners(page);
      await page.goto('/auctions/upcoming');

      // Click Insurance category tab
      const insuranceTab = page.locator('[data-testid="upcoming-category-tab-insurance"]');
      await expect(insuranceTab).toBeVisible();
      await insuranceTab.click();
      await expect(page).toHaveURL(/.*\/auctions\/upcoming\?category=insurance/);
      await expect(insuranceTab).toHaveClass(/active/);

      // Click Used Vehicle tab
      const usedTab = page.locator('[data-testid="upcoming-category-tab-used-vehicle"]');
      await usedTab.click();
      await expect(page).toHaveURL(/.*\/auctions\/upcoming\?category=used-vehicle/);
      await expect(usedTab).toHaveClass(/active/);

      expect(errors).toEqual([]);
    });
  });
});
