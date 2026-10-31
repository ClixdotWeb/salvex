// Admin sidebar: vehicle enquiries and spare part enquiries are separate sections with "new" counts,
// and a notification link opens the enquiry directly.
import { test, expect } from '@playwright/test';
import { mockApi, open, USERS } from './helpers/mockApi';

const RID = '17171717-1717-4717-8717-171717171717';
const request = {
  id: RID, number: 'PRQ-2026-000004', part_id: null, vehicle_make: 'Maruti Suzuki', vehicle_model: 'Swift', vehicle_year: 2019,
  part_name: 'Front bumper', details: 'Original part please', status: 'new', admin_note: null, contact_phone: '+91 98470 12345', buyer_id: 'SLX-000005',
  created_at: '2026-10-25T05:00:00Z', updated_at: '2026-10-25T05:00:00Z', user_id: USERS.bidder.id, user_name: 'Shadin Muhammed',
  user_email: 'shadin@example.com', user_mobile: '+91 98470 12345',
};

test.describe('admin enquiry sections', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop admin layout');

  test('separate sections with new counts; a notification link opens the spare part enquiry', async ({ page }) => {
    const api = await mockApi(page);
    api.signIn(USERS.admin);
    api.override('GET /api/admin/dashboard', () => api.json(200, {
      enquiries_new: 2, part_requests_new: 1, contact_messages_new: 0, kyc_waiting_review: 3, vehicles_waiting_review: 0,
      server_time: new Date().toISOString(),
    }));
    api.state.data.set('/api/admin/part-requests', [request]);
    api.override(`GET /api/admin/part-requests/${RID}`, () => api.json(200, request));

    await open(page, '/admin');
    const nav = page.getByRole('navigation', { name: 'Admin sections' });
    await expect(nav.locator('.adm-nav-group')).toHaveText(['Enquiries', 'Vehicles & auctions', 'Buyers', 'More']);
    await expect(nav.getByRole('button', { name: 'Vehicle enquiries (2 new)' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Spare part enquiries (1 new)' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'KYC verification (3 new)' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Contact messages', exact: true })).toBeVisible();   // nothing new: no badge

    await nav.getByRole('button', { name: /Spare part enquiries/ }).click();
    await expect(page.locator('.adm-section-head h2')).toHaveText('Spare part enquiries');
    await expect(page.locator('tbody')).toContainText('Front bumper');
    await nav.getByRole('button', { name: 'Spare parts catalogue' }).click();
    await expect(page.locator('.adm-section-head h2')).toHaveText('Spare parts catalogue');
    await nav.getByRole('button', { name: /Vehicle enquiries/ }).click();
    await expect(page.locator('.adm-section-head h2')).toHaveText('Vehicle enquiries');

    // the notification link (and an older tab=parts link) open that enquiry
    for (const tab of ['part-enquiries', 'parts']) {
      await open(page, `/admin?tab=${tab}&status=new&open=${RID}`);
      await expect(page.getByRole('dialog')).toContainText('PRQ-2026-000004');
      await expect(page.locator('.adm-section-head h2')).toHaveText('Spare part enquiries');
    }
  });
});


test.describe('spare part enquiry: the team calls the customer', () => {
  test('a buyer whose account has a mobile number is not asked for it again', async ({ page }) => {
    const api = await mockApi(page);
    api.signIn({ ...USERS.bidder, mobile: '+91 90000 11111' });
    api.override('POST /api/part-requests', ({ body }) => api.json(201, { ...request, ...body, id: RID }));
    await open(page, '/spare-parts');
    await page.getByRole('button', { name: /Request a part/i }).first().click();
    const form = page.getByRole('dialog', { name: 'Request a part' });
    await expect(form.locator('label', { hasText: 'Your phone number' })).toHaveCount(0);
    await expect(form).toContainText('We will call you on +91 90000 11111');
    await form.locator('label', { hasText: 'Vehicle make' }).locator('input').fill('Maruti Suzuki');
    await form.locator('label', { hasText: 'Model' }).locator('input').fill('Swift');
    await form.locator('label', { hasText: 'Part needed' }).locator('input').fill('Front bumper');
    await form.getByRole('button', { name: 'Send request' }).click();
    await expect(form).toContainText('Our team will call you on +91 90000 11111');
    expect(api.callsTo('POST', '/api/part-requests')[0].body.contact_phone).toBe('+91 90000 11111');
  });

  test('a buyer without a number on the account leaves one; admin calls, marks contacted with an internal note', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop admin flow');
    const api = await mockApi(page);
    api.signIn(USERS.bidder);
    api.override('POST /api/part-requests', ({ body }) => api.json(201, { ...request, ...body, id: RID }));
    await open(page, '/spare-parts');
    await page.getByRole('button', { name: /Request a part/i }).first().click();
    const form = page.getByRole('dialog', { name: 'Request a part' });
    await form.locator('label', { hasText: 'Vehicle make' }).locator('input').fill('Maruti Suzuki');
    await form.locator('label', { hasText: 'Model' }).locator('input').fill('Swift');
    await form.locator('label', { hasText: 'Part needed' }).locator('input').fill('Front bumper');
    await form.locator('label', { hasText: 'Your phone number' }).locator('input').fill('+91 98470 12345');
    await form.getByRole('button', { name: 'Send request' }).click();
    await expect(form).toContainText('Our team will call you on +91 98470 12345');
    expect(api.callsTo('POST', '/api/part-requests')[0].body.contact_phone).toBe('+91 98470 12345');

    api.signIn(USERS.admin);
    api.state.data.set('/api/admin/part-requests', [request]);
    api.override(`GET /api/admin/part-requests/${RID}`, () => api.json(200, request));
    api.override(`POST /api/admin/part-requests/${RID}/update`, ({ body }) => api.json(200, { ...request, ...body }));
    await open(page, `/admin?tab=part-enquiries&status=new&open=${RID}`);
    const modal = page.getByRole('dialog');
    await expect(modal.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:+919847012345');
    await expect(modal.getByText('Price quoted')).toHaveCount(0);
    await modal.locator('.adm-field', { hasText: 'Status' }).locator('.sx-select').click();
    await page.getByRole('option', { name: 'Contacted' }).click();
    await modal.locator('.adm-field', { hasText: 'Note' }).locator('textarea').fill('Rs 2,800, collects Monday');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('PRQ-2026-000004 updated.')).toBeVisible();
    expect(api.callsTo('POST', `/api/admin/part-requests/${RID}/update`)[0].body)
      .toEqual({ status: 'contacted', admin_note: 'Rs 2,800, collects Monday' });
  });
});
