// Admin photos: shrunk in the browser + thumbnail, cover / order, and photos for drafts after a bulk import.
import { test, expect } from '@playwright/test';
import { mockApi, open, USERS } from './helpers/mockApi';

const VID = '12121212-1212-4212-8212-121212121212';
const V2 = '13131313-1313-4313-8313-131313131313';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const vehicle = (id, photos) => ({
  id, status: 'draft', category: 'insurance', listing_type: 'auction', registration_number: 'KL07AB1234', claim_number: 'CLM-1',
  make: 'Maruti Suzuki', model: 'Swift', variant: 'VXI', manufacturing_year: 2019, registration_year: 2019, fuel_type: 'petrol',
  transmission: 'manual', number_of_owners: 1, damage_type: 'accident', damage_other: null, location: 'Kochi Yard', rc_status: 'available',
  registration_type: 'private', hypothecation_status: 'not_hypothecated', km_driven: null, superdari: null, sold_at: null,
  owner_id: USERS.admin.id, created_at: '2026-10-25T05:00:00Z', submitted_at: null, reviewed_at: null, review_reason: null, photos,
});
const photo = (n) => ({ id: `0000000${n}-0000-4000-8000-00000000000${n}`, content_type: 'image/jpeg', size_bytes: 1000,
  uploaded_at: '2026-10-25T05:00:00Z', position: n - 1, has_thumbnail: true });

test.describe('admin photos', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop admin flow');

  test('photos are made smaller, get a thumbnail, and the cover can be changed', async ({ page }) => {
    const api = await mockApi(page);
    api.signIn(USERS.admin);
    let photos = [photo(1)];
    api.override(`GET /api/admin/vehicles/${VID}`, () => api.json(200, vehicle(VID, photos)));
    api.override(`POST /api/vehicles/${VID}/photos`, () => { photos = [...photos, photo(2)]; return api.json(201, photo(2)); });
    api.override(`PUT /api/vehicles/${VID}/photos/${photo(2).id}/thumbnail`, () => ({ status: 204, body: '' }));
    api.override(`PUT /api/vehicles/${VID}/photos/order`, ({ body }) => {
      photos = body.photo_ids.map((id) => photos.find((p) => p.id === id));
      return api.json(200, photos);
    });

    await open(page, `/admin?tab=vehicles&status=draft&open=${VID}`);
    const modal = page.getByRole('dialog');
    await expect(modal.getByRole('button', { name: 'Add photos' })).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Choose photos' })).toHaveCount(0);                 // one button only
    await expect(modal.getByLabel('Add photos', { exact: true })).toHaveAttribute('accept', 'image/*');
    await modal.getByLabel('Add photos', { exact: true }).setInputFiles({ name: 'IMG_2034.png', mimeType: 'image/png', buffer: PNG });
    await page.getByRole('dialog', { name: /Crop photo/ }).getByRole('button', { name: 'Crop and use' }).click();   // every new photo is cropped to 1:1
    await expect(modal.locator('.adm-photos figure')).toHaveCount(2);

    const upload = api.callsTo('POST', `/api/vehicles/${VID}/photos`)[0];
    expect(upload.headers['content-type']).toBe('image/jpeg');                     // re-encoded in the browser
    expect(api.callsTo('PUT', `/api/vehicles/${VID}/photos/${photo(2).id}/thumbnail`)).toHaveLength(1);
    await expect(modal.locator('.adm-photos img').first()).toHaveAttribute('src', /size=thumb/);

    await modal.getByRole('button', { name: 'Make photo 2 the cover' }).click();
    await expect.poll(() => api.callsTo('PUT', `/api/vehicles/${VID}/photos/order`).length).toBe(1);
    expect(api.callsTo('PUT', `/api/vehicles/${VID}/photos/order`)[0].body).toEqual({ photo_ids: [photo(2).id, photo(1).id] });
  });

  test('bulk upload: chosen category, claim-number photo names, and photos for drafts after the import', async ({ page }) => {
    const api = await mockApi(page);
    api.signIn(USERS.admin);
    const rows = [
      { row: 2, registration_number: 'KL07AB1234', claim_number: 'CLM-1', category: 'bank_nbfc', title: '2019 Maruti Suzuki Swift VXI', listing_type: 'auction', auction: null, errors: [] },
      { row: 3, registration_number: 'KL01CD5678', claim_number: 'CLM-2', category: 'bank_nbfc', title: '2020 Hyundai i20 Asta', listing_type: 'auction', auction: null, errors: [] },
    ];
    api.override('POST /api/admin/vehicles/bulk-check', () => api.json(200, { rows, valid: 2, invalid: 0, with_auction: 0 }));
    api.override('POST /api/admin/vehicles/bulk-import', () => api.json(200, {
      created: [{ ...rows[0], vehicle_id: VID }, { ...rows[1], vehicle_id: V2 }], skipped: [] }));
    api.override(`POST /api/vehicles/${VID}/photos`, () => api.json(201, photo(1)));
    let v2photos = [];
    api.override(`GET /api/admin/vehicles/${V2}`, () => api.json(200, vehicle(V2, v2photos)));
    api.override(`POST /api/vehicles/${V2}/photos`, () => { v2photos = [photo(3)]; return api.json(201, photo(3)); });
    api.override('POST /api/admin/vehicles/bulk-publish', ({ body }) => api.json(200, {
      results: body.items.map((i) => ({ vehicle_id: i.vehicle_id, registration_number: i.vehicle_id === VID ? 'KL07AB1234' : 'KL01CD5678',
        status: 'approved', published: true, auction_id: null, error: null, code: null })),
      published: body.items.length, auctions: 0, failed: 0 }));

    await open(page, '/admin?tab=vehicles');
    await page.getByRole('button', { name: 'Bulk upload' }).click();
    const modal = page.getByRole('dialog', { name: 'Bulk upload vehicles' });
    await modal.locator('.adm-bulk-category .sx-select').click();
    await page.getByRole('option', { name: 'Bank / NBFC' }).click();
    await modal.getByLabel('Vehicle file').setInputFiles({ name: 'vehicles.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('PK\x03\x04') });
    await expect(modal.locator('.adm-bulk-summary')).toContainText('2 ready');
    expect(api.callsTo('POST', '/api/admin/vehicles/bulk-check')[0].query).toBe('?category=bank_nbfc&listing=auction');
    await expect(modal.locator('.adm-bulk-table')).toContainText('Bank / NBFC');

    // a photo named with the claim number belongs to KL07AB1234
    await modal.getByLabel('Photo files').setInputFiles({ name: 'CLM-1 front.png', mimeType: 'image/png', buffer: PNG });
    await expect(modal.locator('.adm-bulk-photos')).toContainText('1 photos matched to 1 vehicles');

    await modal.getByRole('button', { name: 'Import 2 vehicles' }).click();
    await expect(modal.locator('.adm-bulk-result')).toContainText('Upload finished');
    expect(api.callsTo('POST', '/api/admin/vehicles/bulk-import')[0].query).toBe('?category=bank_nbfc&listing=auction');

    // KL01CD5678 had no photo: it waits in the draft list; add a photo there and publish it
    const drafts = modal.locator('.adm-bulk-drafts');
    await expect(drafts).toContainText('KL01CD5678');
    await expect(drafts.locator('.adm-bulk-draft-head')).toHaveCount(1);
    await drafts.getByLabel('Add photos', { exact: true }).setInputFiles({ name: 'any-name.png', mimeType: 'image/png', buffer: PNG });
    await page.getByRole('dialog', { name: /Crop photo/ }).getByRole('button', { name: 'Crop and use' }).click();   // every new photo is cropped to 1:1
    await expect(drafts.locator('.adm-bulk-draft-head')).toContainText('1 photo(s)');
    await drafts.getByRole('button', { name: 'Publish 1 vehicle with photos' }).click();
    await expect(drafts).toContainText('All vehicles from this file are published');
    const last = api.callsTo('POST', '/api/admin/vehicles/bulk-publish').at(-1).body;
    expect(last.items).toEqual([{ vehicle_id: V2 }]);
  });
});

test.describe('photos of published and locked vehicles', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop admin flow');

  test('the last photo of a published vehicle cannot be deleted; a vehicle in an auction cannot be changed', async ({ page }) => {
    const api = await mockApi(page);
    api.signIn(USERS.admin);
    const published = { ...vehicle(VID, [photo(1)]), status: 'approved', locked: false };
    api.override(`GET /api/admin/vehicles/${VID}`, () => api.json(200, published));
    await open(page, `/admin?tab=ready-to-lift&status=all&open=${VID}`);
    const modal = page.getByRole('dialog', { name: /KL07AB1234/ });
    await expect(modal.getByRole('button', { name: 'Delete photo 1' })).toBeDisabled();
    await expect(modal.getByRole('button', { name: 'Add photos' })).toBeVisible();

    const locked = { ...vehicle(V2, [photo(1), photo(2)]), id: V2, status: 'approved', locked: true };
    api.override(`GET /api/admin/vehicles/${V2}`, () => api.json(200, locked));
    await open(page, `/admin?tab=auctions&status=waiting&open=${V2}`);
    const lockedModal = page.getByRole('dialog', { name: /KL07AB1234/ });
    await expect(lockedModal).toContainText('in an auction or sold');
    await expect(lockedModal.getByRole('button', { name: 'Add photos' })).toHaveCount(0);
    await expect(lockedModal.getByRole('button', { name: 'Delete photo 1' })).toHaveCount(0);
    await expect(lockedModal.getByRole('button', { name: 'Crop photo 1' })).toHaveCount(0);
  });
});
