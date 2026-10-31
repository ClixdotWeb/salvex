// Admin > Ready to Lift > Add vehicle: steps (Vehicle details -> Photos), no Listing field, publish.
import { test, expect } from '@playwright/test';
import { mockApi, open, USERS } from './helpers/mockApi';

const OPTIONS = {
  category: { insurance: 'Insurance', bank_nbfc: 'Bank / NBFC', used_vehicle: 'Used vehicle' },
  fuel_type: { petrol: 'Petrol', diesel: 'Diesel' },
  transmission: { manual: 'Manual', automatic: 'Automatic' },
  damage_type: { accident: 'Accident', other: 'Other' },
  rc_status: { available: 'RC available' },
  registration_type: { private: 'Private' },
  hypothecation_status: { not_hypothecated: 'Not hypothecated' },
};
const VID = '18181818-1818-4818-8818-181818181818';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test.describe('admin add vehicle', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop admin flow');

  test('steps, Ready to Lift fields, photos, publish', async ({ page }) => {
    const api = await mockApi(page);
    api.signIn(USERS.admin);
    let vehicle = null;
    const photos = [];
    const view = () => ({ ...vehicle, photos: [...photos] });
    api.override('GET /api/catalogue/vehicle-options', () => api.json(200, OPTIONS));
    api.override('POST /api/vehicles', ({ body }) => {
      vehicle = { id: VID, status: 'draft', owner_id: USERS.admin.id, ...body, created_at: new Date().toISOString() };
      return api.json(201, view());
    });
    api.override(`GET /api/admin/vehicles/${VID}`, () => api.json(200, view()));
    api.override(`POST /api/vehicles/${VID}/photos`, () => {
      const p = { id: '19191919-1919-4919-8919-191919191919', content_type: 'image/jpeg', size_bytes: 100, uploaded_at: new Date().toISOString(), position: 0 };
      photos.push(p);
      return api.json(201, p);
    });
    api.override(`POST /api/vehicles/${VID}/submit`, () => { vehicle.status = 'submitted'; return api.json(200, view()); });
    api.override(`POST /api/admin/vehicles/${VID}/review`, () => { vehicle.status = 'approved'; return api.json(200, view()); });

    await open(page, '/admin?tab=ready-to-lift');
    await expect(page.locator('.adm-section-head h2')).toHaveText('Ready to Lift');
    await page.getByRole('button', { name: 'Add vehicle' }).click();
    const modal = page.getByRole('dialog', { name: 'Add Ready to Lift vehicle' });
    await expect(modal.locator('.vf-field', { hasText: 'Listing' })).toHaveCount(0);          // decided by the section
    await expect(modal.locator('.adm-steps li')).toHaveText(['1Vehicle details', '2Photos']);
    await expect(modal.locator('.adm-steps li.current')).toContainText('Vehicle details');

    const fill = (label, value) => modal.locator('.vf-field', { hasText: label }).locator('input').fill(value);
    const choose = async (label, option) => {
      await modal.locator('.vf-field', { hasText: label }).locator('.sx-select').click();
      await page.getByRole('option', { name: option, exact: true }).click();
    };
    await fill('Registration number', 'KL07AB1234');
    await fill('Claim number', 'CLM-1');
    await fill('Make', 'Maruti Suzuki');
    await fill('Model', 'Swift');
    await fill('Variant', 'VXi');
    await fill('Manufacturing year', '2019');
    await fill('Registration year', '2019');
    await choose('Fuel type', 'Petrol');
    await choose('Transmission', 'Manual');
    await fill('Number of owners', '1');
    await choose('Damage type', 'Accident');
    await fill('Vehicle location', 'Kochi Yard');
    await choose('RC status', 'RC available');
    await choose('Registration type', 'Private');
    await choose('Hypothecation status', 'Not hypothecated');
    await expect(modal.locator('.vf-field', { hasText: 'Auction category' })).toHaveCount(0);   // Ready to Lift: no auction
    await fill('KM driven', '48210');
    await choose('Superdari', 'No');
    await modal.getByRole('button', { name: 'Continue to photos' }).click();

    await expect(modal.locator('.adm-steps li.current')).toContainText('Photos');
    await expect(modal.locator('.adm-steps li.done')).toContainText('Vehicle details');
    await expect(modal.getByRole('button', { name: 'Publish vehicle' })).toBeDisabled();
    await modal.getByLabel('Add photos', { exact: true }).setInputFiles({ name: 'front.png', mimeType: 'image/png', buffer: PNG });
    await page.getByRole('dialog', { name: /Crop photo/ }).getByRole('button', { name: 'Crop and use' }).click();   // every new photo is cropped to 1:1
    await expect(modal.locator('.adm-photos figure')).toHaveCount(1);
    await modal.getByRole('button', { name: 'Publish vehicle' }).click();

    await expect(page.getByText('KL07AB1234 is published on the website.')).toBeVisible();
    const created = api.callsTo('POST', '/api/vehicles')[0].body;
    expect(created).toMatchObject({ listing_type: 'ready_to_lift', km_driven: 48210, superdari: false });
    expect(created).not.toHaveProperty('category');
  });
});

test.describe('admin sections for vehicles', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop admin layout');

  test('Ready to Lift is its own section; vehicles for auction sit under Auctions', async ({ page }) => {
    const api = await mockApi(page);
    api.signIn(USERS.admin);
    await open(page, '/admin');
    const nav = page.getByRole('navigation', { name: 'Admin sections' });
    await expect(nav.getByRole('button', { name: 'Ready to Lift', exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Vehicles', exact: true })).toHaveCount(0);

    await nav.getByRole('button', { name: 'Ready to Lift', exact: true }).click();
    await expect(page.locator('.adm-section-head h2')).toHaveText('Ready to Lift');
    await expect(page.locator('.adm-tabs').first()).toContainText('Available');
    expect(api.callsTo('GET', '/api/admin/vehicles').at(-1).query).toContain('listing_type=ready_to_lift');

    // Auctions: one list - Waiting (vehicles without an auction) | Upcoming | Live | Ended
    api.override('GET /api/admin/vehicles', ({ query }) => api.json(200, {
      items: new URLSearchParams(query).get('ready_for_auction') === 'true' ? [{
        id: VID, status: 'approved', category: 'insurance', listing_type: 'auction', registration_number: 'KL07AB1234', make: 'Maruti Suzuki',
        model: 'Swift', variant: 'VXi', manufacturing_year: 2019, location: 'Kochi Yard', owner_id: USERS.admin.id,
        created_at: '2026-10-25T05:00:00Z', submitted_at: null, cover_photo_id: null, sold_at: null }] : [],
      page: 1, page_size: 25, total: new URLSearchParams(query).get('ready_for_auction') === 'true' ? 1 : 0, pages: 1 }));
    await nav.getByRole('button', { name: 'Auctions', exact: true }).click();
    const tabs = page.locator('.adm-auction-tabs button');
    await expect(tabs).toHaveText(['Waiting1', 'Upcoming', 'Live', 'Ended']);
    await tabs.first().click();
    await expect(page.locator('tbody')).toContainText('KL07AB1234');
    await page.getByRole('button', { name: 'Start auction' }).click();
    await expect(page.getByRole('dialog', { name: 'New auction' })).toBeVisible();
    await page.keyboard.press('Escape');
    await tabs.nth(2).click();
    expect(api.callsTo('GET', '/api/admin/auctions').at(-1).query).toContain('view=live');
  });
});

test.describe('closing half-way and adding the same vehicle again', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop admin flow');

  test('the earlier draft is continued instead of "already listed"; a published one is explained', async ({ page }) => {
    const api = await mockApi(page);
    api.signIn(USERS.admin);
    const draft = { id: VID, status: 'draft', listing_type: 'ready_to_lift', registration_number: 'KL07AB1234', make: 'Maruti Suzuki', model: 'Swift',
      variant: 'VXi', manufacturing_year: 2019, location: 'Kochi Yard', category: 'insurance', owner_id: USERS.admin.id,
      created_at: '2026-10-25T05:00:00Z', submitted_at: null, cover_photo_id: null, sold_at: null };
    api.override('GET /api/catalogue/vehicle-options', () => api.json(200, OPTIONS));
    api.override('POST /api/vehicles', () => api.json(409, { detail: 'A vehicle with this registration number is already listed.', code: 'registration_exists' }));
    api.override('GET /api/admin/vehicles', ({ query }) => api.json(200, {
      items: new URLSearchParams(query).get('q') ? [draft] : [], page: 1, page_size: 50, total: 1, pages: 1 }));
    api.override(`PATCH /api/vehicles/${VID}`, ({ body }) => api.json(200, { ...draft, ...body, registration_number: 'KL07AB1234' }));
    api.override(`GET /api/admin/vehicles/${VID}`, () => api.json(200, { ...draft, photos: [] }));

    const addAgain = async () => {
      await page.getByRole('button', { name: 'Add vehicle' }).click();
      const modal = page.getByRole('dialog', { name: 'Add Ready to Lift vehicle' });
      const fill = (label, value) => modal.locator('.vf-field', { hasText: label }).locator('input').fill(value);
      const choose = async (label, option) => {
        await modal.locator('.vf-field', { hasText: label }).locator('.sx-select').click();
        await page.getByRole('option', { name: option, exact: true }).click();
      };
      await fill('Registration number', 'KL 07 AB 1234');
      await fill('Claim number', 'CLM-1');
      await fill('Make', 'Maruti Suzuki');
      await fill('Model', 'Swift');
      await fill('Variant', 'VXi');
      await fill('Manufacturing year', '2019');
      await fill('Registration year', '2019');
      await choose('Fuel type', 'Petrol');
      await choose('Transmission', 'Manual');
      await fill('Number of owners', '1');
      await choose('Damage type', 'Accident');
      await fill('Vehicle location', 'Kochi Yard');
      await choose('RC status', 'RC available');
      await choose('Registration type', 'Private');
      await choose('Hypothecation status', 'Not hypothecated');
      await fill('KM driven', '48210');
      await choose('Superdari', 'No');
      await modal.getByRole('button', { name: 'Continue to photos' }).click();
      return modal;
    };

    await open(page, '/admin?tab=ready-to-lift');
    const modal = await addAgain();
    await expect(modal.locator('.adm-steps li.current')).toContainText('Photos');
    await expect(modal).toContainText('You had started KL07AB1234 earlier');
    expect(api.callsTo('PATCH', `/api/vehicles/${VID}`)).toHaveLength(1);
    // closing half-way says where the draft is
    await modal.getByRole('button', { name: 'Save as draft' }).click();
    await expect(page.getByText(/KL07AB1234 is saved as a draft/)).toBeVisible();

    // a vehicle that is already published is not a draft: a clear message, nothing is changed
    draft.status = 'approved';
    const again = await addAgain();
    await expect(again).toContainText('KL07AB1234 is already added and published. Find it under Ready to Lift');
    await expect(again.locator('.adm-steps li.current')).toContainText('Vehicle details');
    expect(api.callsTo('PATCH', `/api/vehicles/${VID}`)).toHaveLength(1);
  });
});
