// Ready to Lift: public list (no price, "I'm interested") and the admin enquiry list.
import { test, expect } from '@playwright/test';
import { mockApi, open, USERS } from './helpers/mockApi';

const VID = '55555555-5555-4555-8555-555555555555';
const EID = '66666666-6666-4666-8666-666666666666';
const vehicle = {
  id: VID, make: 'Maruti Suzuki', model: 'Swift', variant: 'VXI', manufacturing_year: 2019, registration_masked: 'KL07 •• 4521',
  category: 'insurance', location: 'Aluva Yard', fuel_type: 'petrol', km_driven: 48210, superdari: false,
  listing_type: 'ready_to_lift', photo_ids: [], sold_at: null,
};
const enquiry = (over = {}) => ({
  id: EID, number: 'ENQ-2026-000001', vehicle_id: VID, status: 'new', created_at: '2026-10-25T05:00:00Z',
  admin_note: null, updated_at: '2026-10-25T05:00:00Z', vehicle_title: '2019 Maruti Suzuki Swift VXI',
  registration_number: 'KL07AB4521', claim_number: 'CLM-2026-0101', location: 'Aluva Yard', vehicle_sold: false,
  cover_photo_id: null, buyer_id: 'SLX-000005', buyer_user_id: USERS.bidder.id, buyer_name: 'Shadin Muhammed',
  buyer_email: 'shadin@example.com', buyer_mobile: '+91 98470 12345', buyer_kyc_status: 'verified', ...over,
});

test('buyer sees Ready to Lift without a price and taps I\'m interested', async ({ page }) => {
  const api = await mockApi(page);
  api.signIn(USERS.bidder);
  api.state.data.set('/api/ready-to-lift', [vehicle]);
  api.override(`POST /api/ready-to-lift/${VID}/interest`, () => api.json(201, { id: EID, number: 'ENQ-2026-000001', vehicle_id: VID, status: 'new', created_at: new Date().toISOString() }));

  await open(page, '/ready-to-lift');
  const card = page.locator('.pub-rtl-card').first();
  await expect(card).toContainText('2019 Maruti Suzuki Swift');
  await expect(card).toContainText('48,210 km');
  await expect(card).toContainText('Superdari: No');
  await expect(card).not.toContainText('₹');
  await expect(page.locator('.pub-rtl-note')).toContainText('Affidavit submission');

  // the first tap only opens a confirmation; nothing is sent yet
  await card.getByRole('button', { name: "I'm interested" }).click();
  const confirm = page.getByRole('dialog', { name: 'Confirm your interest' });
  await expect(confirm).toContainText('2019 Maruti Suzuki Swift');
  await expect(confirm).toContainText('Affidavit submission');
  await expect(confirm.getByRole('button', { name: 'Send my interest' })).toBeDisabled();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');      // the page behind does not scroll
  expect(api.callsTo('POST', `/api/ready-to-lift/${VID}/interest`)).toHaveLength(0);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  expect(api.callsTo('POST', `/api/ready-to-lift/${VID}/interest`)).toHaveLength(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  // open again, tick, send
  await card.getByRole('button', { name: "I'm interested" }).click();
  await confirm.getByRole('checkbox').check();
  await confirm.getByRole('button', { name: 'Send my interest' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(card.locator('.pub-interest-sent')).toHaveText('Interest sent');
  expect(api.callsTo('POST', `/api/ready-to-lift/${VID}/interest`)).toHaveLength(1);
});

test('signed-out visitor is sent to sign in from I\'m interested', async ({ page }) => {
  const api = await mockApi(page);
  api.state.data.set('/api/ready-to-lift', [vehicle]);
  await open(page, '/ready-to-lift');
  await page.locator('.pub-rtl-card').first().getByRole('link', { name: "I'm interested" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test.describe('admin enquiries', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop admin flow');

  test('admin opens an enquiry, sees the buyer and marks it contacted', async ({ page }) => {
    const api = await mockApi(page);
    api.signIn(USERS.admin);
    let current = enquiry();
    api.state.data.set('/api/admin/enquiries', [current]);
    api.override(`GET /api/admin/enquiries/${EID}`, () => api.json(200, current));
    api.override(`POST /api/admin/enquiries/${EID}/update`, ({ body }) => { current = enquiry({ ...body }); return api.json(200, current); });

    await open(page, `/admin?tab=enquiries&status=new&open=${EID}`);
    const modal = page.getByRole('dialog');
    await expect(modal).toContainText('SLX-000005');
    await expect(modal).toContainText('+91 98470 12345');
    await expect(modal).toContainText('CLM-2026-0101');
    await expect(modal.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:+919847012345');

    await modal.locator('.adm-field', { hasText: 'Status' }).locator('.sx-select').click();
    await page.getByRole('option', { name: 'Contacted' }).click();
    await modal.locator('.adm-field', { hasText: 'Note' }).locator('textarea').fill('Called, visiting Monday');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('ENQ-2026-000001 updated.')).toBeVisible();
    expect(api.callsTo('POST', `/api/admin/enquiries/${EID}/update`)[0].body).toEqual({ status: 'contacted', admin_note: 'Called, visiting Monday' });
  });
});
