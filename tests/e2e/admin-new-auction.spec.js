// Admin: New auction in one flow (vehicle details -> photos -> auction settings), with the themed drop-downs.
import { test, expect } from '@playwright/test';
import { mockApi, open, USERS } from './helpers/mockApi';

const OPTIONS = {
  category: { insurance: 'Insurance', bank_nbfc: 'Bank / NBFC', used_vehicle: 'Used vehicle' },
  fuel_type: { petrol: 'Petrol', diesel: 'Diesel' },
  transmission: { manual: 'Manual', automatic: 'Automatic' },
  damage_type: { accident: 'Accident', flood: 'Flood / water', other: 'Other' },
  rc_status: { available: 'RC available' },
  registration_type: { private: 'Private' },
  hypothecation_status: { not_hypothecated: 'Not hypothecated' },
};
const VID = '44444444-4444-4444-8444-444444444444';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test.describe('admin new auction', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop admin flow');

  test('vehicle form, then photos, then auction settings', async ({ page }) => {
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
      const p = { id: `55555555-5555-4555-8555-55555555555${photos.length}`, content_type: 'image/png', size_bytes: PNG.length, uploaded_at: new Date().toISOString() };
      photos.push(p);
      return api.json(201, p);
    });
    api.override(`POST /api/vehicles/${VID}/submit`, () => { vehicle.status = 'submitted'; return api.json(200, view()); });
    api.override(`POST /api/admin/vehicles/${VID}/review`, ({ body }) => {
      expect(body.decision).toBe('approve');
      vehicle.status = 'approved';
      return api.json(200, view());
    });
    let auctionBody = null;
    api.override('POST /api/admin/auctions', ({ body }) => {
      auctionBody = body;
      return api.json(201, { id: '66666666-6666-4666-8666-666666666666', vehicle_id: VID, ...body });
    });

    await open(page, '/admin?tab=auctions');
    await page.getByRole('button', { name: 'New auction' }).click();
    const modal = page.getByRole('dialog', { name: 'New auction' });
    await expect(modal.locator('.adm-steps li.current')).toContainText('Vehicle details');

    // Step 1: text fields + themed drop-downs (no native <select> anywhere)
    await expect(page.locator('select')).toHaveCount(0);
    const fill = async (label, value) => modal.locator('.vf-field', { hasText: label }).locator('input').fill(value);
    const choose = async (label, option) => {
      await modal.locator('.vf-field', { hasText: label }).locator('.sx-select').click();
      await page.getByRole('option', { name: option }).click();
    };
    await fill('Registration number', 'KL07AB1234');
    await fill('Claim number', 'CLM-1');
    await fill('Make', 'Maruti Suzuki');
    await fill('Model', 'Swift');
    await fill('Variant', 'VXi');
    await fill('Manufacturing year', '2019');
    await fill('Registration year', '2019');
    await choose('Fuel type', 'Diesel');
    await choose('Transmission', 'Manual');
    await fill('Number of owners', '1');
    // "Other" asks for a typed description; another type hides it again
    await choose('Damage type', 'Other');
    await expect(modal.locator('.vf-field', { hasText: 'Describe the damage' })).toBeVisible();
    await fill('Describe the damage', 'Rat bite on wiring');
    await choose('Damage type', 'Accident');
    await expect(modal.locator('.vf-field', { hasText: 'Describe the damage' })).toHaveCount(0);
    await fill('Vehicle location', 'Kochi Yard');
    await choose('RC status', 'RC available');
    await choose('Registration type', 'Private');
    await choose('Hypothecation status', 'Not hypothecated');
    // keyboard works too: open with Enter, move with arrows, choose with Enter
    const category = modal.locator('.vf-field', { hasText: 'Auction category' }).locator('.sx-select');
    await category.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(category).toContainText('Insurance');
    await modal.getByRole('button', { name: 'Continue to photos' }).click();

    // Step 2: photos, then confirm (submit + approve)
    await expect(modal.locator('.adm-steps li.current')).toContainText('Photos');
    await expect(modal.getByRole('button', { name: 'Confirm vehicle' })).toBeDisabled();
    await modal.getByLabel('Add photos', { exact: true }).setInputFiles({ name: 'front.png', mimeType: 'image/png', buffer: PNG });
    await page.getByRole('dialog', { name: /Crop photo/ }).getByRole('button', { name: 'Crop and use' }).click();   // every new photo is cropped to 1:1
    await expect(modal.locator('.adm-photos figure')).toHaveCount(1);
    await modal.getByRole('button', { name: 'Confirm vehicle' }).click();

    // Step 3: auction settings for that vehicle
    await expect(modal.locator('.adm-steps li.current')).toContainText('Auction settings');
    await expect(modal.locator('.adm-wizard-vehicle')).toContainText('2019 Maruti Suzuki Swift VXi');
    await modal.locator('.adm-field', { hasText: 'Starting price' }).locator('input').fill('50000');
    await modal.getByRole('button', { name: 'Create auction' }).click();

    await expect.poll(() => auctionBody).not.toBeNull();
    expect(auctionBody).toMatchObject({ vehicle_id: VID, starting_price: '50000', extension_enabled: true, extension_minutes: 2 });
    const created = api.callsTo('POST', '/api/vehicles')[0].body;
    expect(created).toMatchObject({ category: 'insurance', fuel_type: 'diesel', registration_number: 'KL07AB1234', number_of_owners: 1, damage_type: 'accident', damage_other: null });
  });
});
