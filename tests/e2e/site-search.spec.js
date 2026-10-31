// The search icon opens one search for the whole site: auctions, Ready to Lift vehicles and spare parts.
import { test, expect } from '@playwright/test';
import { mockApi, open } from './helpers/mockApi';

const vehicle = (id, model, extra = {}) => ({
  id, make: 'Hyundai', model, variant: 'Sportz', manufacturing_year: 2022, registration_masked: 'KL11**3456', category: 'used_vehicle',
  location: 'Kollam', photo_ids: [], fuel_type: 'petrol', km_driven: 41000, superdari: false, listing_type: 'auction', ...extra,
});
const soon = () => new Date(Date.now() + 3600e3).toISOString();

test('the search icon opens the search page and finds auctions, Ready to Lift vehicles and parts', async ({ page, isMobile }) => {
  const api = await mockApi(page);
  api.override('GET /api/catalogue/vehicles', ({ query }) => {
    expect(query).toContain('q=i20');
    return api.json(200, { items: [
      vehicle('11111111-0000-4000-8000-000000000001', 'i20', { auction: { id: 'a1111111-0000-4000-8000-000000000001', phase: 'live', starting_price: '20000.00', current_price: '21000.00', bid_count: 1, starts_at: new Date().toISOString(), ends_at: soon() } }),
      vehicle('11111111-0000-4000-8000-000000000002', 'i20 Asta', { auction: null }),           // no open auction: not shown
    ], page: 1, page_size: 24, total: 2, pages: 1 });
  });
  api.override('GET /api/ready-to-lift', () => api.json(200, { items: [vehicle('22222222-0000-4000-8000-000000000001', 'i20 Magna', { listing_type: 'ready_to_lift' })], page: 1, page_size: 12, total: 1, pages: 1 }));
  api.override('GET /api/parts', () => api.json(200, { items: [{ id: 'p1', name: 'i20 front bumper', make: 'Hyundai', model: 'i20', price: '4500.00', has_photo: false, condition: 'used', stock: 2 }], page: 1, page_size: 12, total: 1, pages: 1 }));

  await open(page, '/');
  await page.locator(isMobile ? '#mobile-search-btn' : '#navbar-search-btn-left').click();
  await expect(page).toHaveURL(/\/search$/);
  const box = page.getByRole('searchbox', { name: 'Search the site' });
  await expect(box).toBeFocused();
  await box.fill('i20');
  await expect(page).toHaveURL(/\/search\?q=i20$/);

  await expect(page.getByRole('region', { name: 'Auctions' }).locator('.pub-card')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Ready to Lift' })).toContainText('i20 Magna');
  await expect(page.getByRole('region', { name: 'Spare parts' })).toContainText('i20 front bumper');
  await page.getByRole('region', { name: 'Auctions' }).locator('.pub-card').click();
  await expect(page).toHaveURL(/\/auctions\/a1111111-0000-4000-8000-000000000001$/);
});

test('nothing found explains what to do next', async ({ page }) => {
  const api = await mockApi(page);
  const empty = () => api.json(200, { items: [], page: 1, page_size: 12, total: 0, pages: 0 });
  api.override('GET /api/catalogue/vehicles', empty);
  api.override('GET /api/ready-to-lift', empty);
  api.override('GET /api/parts', empty);
  await open(page, '/search?q=zzzz');
  await expect(page.getByText('Nothing found for “zzzz”')).toBeVisible();
  await expect(page.getByRole('link', { name: /Request a part/ })).toBeVisible();
});
