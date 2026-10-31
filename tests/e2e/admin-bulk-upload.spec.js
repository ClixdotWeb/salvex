// Admin: bulk upload vehicles from a file (check -> photos -> import -> publish) and create several auctions at once.
import { test, expect } from '@playwright/test';
import { mockApi, open, USERS } from './helpers/mockApi';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';
const auction = { starting_price: '150000.00', starts_at: '2026-11-01T04:30:00Z', ends_at: '2026-11-01T06:30:00Z' };
const rows = [
  { row: 2, registration_number: 'KL07AB1234', title: '2019 Maruti Suzuki Swift VXI', listing_type: 'auction', auction, errors: [] },
  { row: 3, registration_number: 'KL01CD5678', title: '2020 Hyundai i20 Asta', listing_type: 'ready_to_lift', auction: null, errors: [] },
  { row: 4, registration_number: 'KL05EF9999', title: '2018 Honda City', listing_type: 'auction', auction: null, errors: ['Fuel type: Input should be ...'] },
];

test.describe('admin bulk upload', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop admin flow');

  test('check the file, match photos by registration number, import and publish', async ({ page }) => {
    const api = await mockApi(page);
    api.signIn(USERS.admin);
    api.override('POST /api/admin/vehicles/bulk-check', () => api.json(200, { rows, valid: 2, invalid: 1, with_auction: 1 }));
    api.override('POST /api/admin/vehicles/bulk-import', () => api.json(200, {
      created: [{ ...rows[0], vehicle_id: V1 }, { ...rows[1], vehicle_id: V2 }], skipped: [rows[2]] }));
    let photoCalls = 0;
    api.override(`POST /api/vehicles/${V1}/photos`, () => { photoCalls += 1; return api.json(201, { id: `p${photoCalls}` }); });
    api.override('POST /api/admin/vehicles/bulk-publish', ({ body }) => api.json(200, {
      results: body.items.map((i) => ({ vehicle_id: i.vehicle_id, registration_number: 'KL07AB1234', status: 'approved', published: true,
        auction_id: i.auction ? '33333333-3333-4333-8333-333333333333' : null, error: null, code: null })),
      published: body.items.length, auctions: body.items.filter((i) => i.auction).length, failed: 0 }));

    await open(page, '/admin?tab=vehicles');
    await page.getByRole('button', { name: 'Bulk upload' }).click();
    const modal = page.getByRole('dialog', { name: 'Bulk upload vehicles' });
    await expect(modal.getByRole('link', { name: 'Excel template' })).toHaveAttribute('href', /bulk-template\?format=xlsx/);

    await modal.getByLabel('Vehicle file').setInputFiles({ name: 'vehicles.csv', mimeType: 'text/csv', buffer: Buffer.from('Registration number*\nKL07AB1234\n') });
    await expect(modal.locator('.adm-bulk-summary')).toContainText('2 ready');
    await expect(modal.locator('.adm-bulk-summary')).toContainText('1 with problems');
    await expect(modal.locator('.adm-row-bad')).toContainText('Fuel type');

    // two photos for KL07AB1234 (one by a dashed name), one that matches no vehicle, one longer registration
    await modal.getByLabel('Photo files').setInputFiles([
      { name: 'KL07AB1234.png', mimeType: 'image/png', buffer: PNG },
      { name: 'KL-07-AB-1234_2.png', mimeType: 'image/png', buffer: PNG },
      { name: 'KL07AB12345.png', mimeType: 'image/png', buffer: PNG },
      { name: 'random.png', mimeType: 'image/png', buffer: PNG },
    ]);
    await expect(modal.locator('.adm-bulk-photos')).toContainText('2 photos matched to 1 vehicles');
    await expect(modal.locator('.adm-bulk-photos')).toContainText('1 vehicle(s) without photos stay as drafts');
    await expect(modal.locator('.adm-bulk-photos')).toContainText('2 photo(s) did not match');

    await modal.getByRole('button', { name: 'Import 2 vehicles' }).click();
    await expect(modal.locator('.adm-bulk-result')).toContainText('Upload finished');
    const result = modal.locator('.adm-bulk-result dl');
    await expect(result).toContainText('Vehicles added2');
    await expect(result).toContainText('Photos uploaded2');
    await expect(result).toContainText('Auctions created1');
    await expect(result).toContainText('Left as drafts1');
    expect(photoCalls).toBe(2);
    const published = api.callsTo('POST', '/api/admin/vehicles/bulk-publish')[0].body;
    expect(published.items).toEqual([{ vehicle_id: V1, auction }]);           // only the vehicle with photos
  });

  test('create auctions for several approved vehicles with staggered endings', async ({ page }) => {
    const api = await mockApi(page);
    api.signIn(USERS.admin);
    const vehicle = (id, reg) => ({ id, status: 'approved', category: 'insurance', listing_type: 'auction', registration_number: reg,
      make: 'Maruti Suzuki', model: 'Swift', variant: 'VXI', manufacturing_year: 2019, location: 'Kochi Yard', owner_id: USERS.admin.id,
      created_at: '2026-10-20T10:00:00Z', submitted_at: '2026-10-20T10:00:00Z', cover_photo_id: null, sold_at: null });
    api.override('GET /api/admin/vehicles', ({ query }) => {
      const ready = new URLSearchParams(query).get('ready_for_auction') === 'true';
      const items = ready ? [vehicle(V1, 'KL07AB1234'), vehicle(V2, 'KL01CD5678')] : [];
      return api.json(200, { items, page: 1, page_size: 100, total: items.length, pages: 1 });
    });
    api.override('POST /api/admin/vehicles/bulk-publish', ({ body }) => api.json(200, {
      results: body.items.map((i, n) => ({ vehicle_id: i.vehicle_id, registration_number: `R${n}`, status: 'approved', published: false,
        auction_id: `4444444${n}-4444-4444-8444-444444444444`, error: null, code: null })),
      published: 0, auctions: body.items.length, failed: 0 }));

    await open(page, '/admin?tab=vehicles');
    await page.getByRole('button', { name: 'Start several together' }).click();
    const modal = page.getByRole('dialog', { name: 'Create auctions' });
    await modal.getByLabel('Select all (2)').check();
    await modal.getByLabel('Same starting price').fill('75000');
    await modal.getByRole('button', { name: 'Apply' }).click();
    await modal.getByLabel('Starting price KL01CD5678').fill('90000');
    await modal.locator('.adm-field', { hasText: 'Gap between endings' }).locator('input').fill('5');
    await modal.getByRole('button', { name: 'Create 2 auctions' }).click();
    await expect(modal).toContainText('2 auctions created');

    const sent = api.callsTo('POST', '/api/admin/vehicles/bulk-publish')[0].body;
    expect(sent.items.map((i) => i.auction.starting_price)).toEqual(['75000', '90000']);
    const [a, b] = sent.items.map((i) => i.auction);
    expect(a.starts_at).toBe(b.starts_at);
    expect(new Date(b.ends_at) - new Date(a.ends_at)).toBe(5 * 60000);
    expect(sent.extension_enabled).toBe(true);
  });
});
