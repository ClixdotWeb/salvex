// Admin: record the deal & service fee on a result, and read the monthly report.
import { test, expect } from '@playwright/test';
import { mockApi, open, USERS } from './helpers/mockApi';

const AID = '77777777-7777-4777-8777-777777777777';
const OID = '99999999-9999-4999-8999-999999999999';
const base = {
  auction_id: AID, vehicle_id: '88888888-8888-4888-8888-888888888888', vehicle_title: '2020 Honda City V CVT',
  registration_number: 'KL01MN7891', category: 'insurance', result: 'sold', starting_price: '450000.00',
  winning_amount: '501000.00', bid_count: 4, closed_at: '2026-10-24T05:00:00Z', winner_id: USERS.bidder.id,
  winner_name: 'Shadin Muhammed', winner_email: 'shadin@example.com', winner_mobile: '+91 98470 12345',
  winner_buyer_id: 'SLX-000005', order_id: OID, order_number: 'ORD-2026-000002', order_status: 'awaiting_payment',
  cover_photo_id: null, approved_amount: '501000.00', service_fee: null, fee_received: '0.00', fee_pending: null,
};
const deal = (over = {}) => ({
  order_id: OID, order_number: 'ORD-2026-000002', approved_amount: '501000.00', approved_at: '2026-10-24T06:30:00Z',
  service_fee: null, fee_received: '0.00', fee_pending: null, last_fee_received_on: null, payments: [], ...over,
});
const detail = (d) => ({
  ...base, location: 'Kochi Yard', starts_at: '2026-10-24T04:00:00Z', ends_at: '2026-10-24T05:00:00Z',
  winner_organization: '', winner_kyc_status: 'verified', winner_since: '2026-10-20T10:00:00Z', winner_is_active: true,
  order_due_at: null, order_utr: null, order_payment_submitted_at: null, order_paid_at: null, top_bids: [],
  claim_number: 'CLM-2026-0442', deal: d,
});

test.describe('admin deal & reports', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop admin flow');

  test('set the service fee and record fee received on a result', async ({ page }) => {
    const api = await mockApi(page);
    api.signIn(USERS.admin);
    let current = deal();
    api.state.data.set('/api/admin/results', [base]);
    api.override(`GET /api/admin/results/${AID}`, () => api.json(200, detail(current)));
    api.override(`PATCH /api/admin/orders/${OID}/deal`, ({ body }) => {
      current = deal({ ...current, service_fee: `${body.service_fee}.00`, fee_pending: `${body.service_fee}.00` });
      return api.json(200, current);
    });
    api.override(`POST /api/admin/orders/${OID}/fees`, ({ body }) => {
      current = deal({ ...current, fee_received: '3000.00', fee_pending: '2000.00', last_fee_received_on: body.received_on,
        payments: [{ id: 'p1', amount: '3000.00', received_on: body.received_on, reference: body.reference, note: null,
          created_at: new Date().toISOString(), created_by_name: 'Alex Admin' }] });
      return api.json(201, current);
    });

    await open(page, `/admin?tab=results&status=sold&open=${AID}`);
    const modal = page.getByRole('dialog');
    await expect(modal.locator('.adm-deal')).toContainText('Not set yet');
    await expect(modal).toContainText('SLX-000005');
    await expect(modal).toContainText('CLM-2026-0442');
    await expect(modal.getByText('No fee recorded yet.')).toBeVisible();

    await modal.getByRole('button', { name: 'Edit' }).click();
    await modal.locator('.adm-field', { hasText: 'Service fee' }).locator('input').fill('5000');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal.locator('.adm-fee-box.pending')).toContainText('₹5,000');
    expect(api.callsTo('PATCH', `/api/admin/orders/${OID}/deal`)[0].body).toEqual({ service_fee: '5000' });

    await modal.locator('.adm-fee-form .adm-field', { hasText: 'Amount received' }).locator('input').fill('3000');
    await modal.locator('.adm-fee-form .adm-field', { hasText: 'Reference no.' }).locator('input').fill('UPI 4567');
    await modal.getByRole('button', { name: 'Add fee received' }).click();
    await expect(modal.locator('.adm-fee-box.received')).toContainText('₹3,000');
    await expect(modal.locator('.adm-fee-box.pending')).toContainText('₹2,000');
    await expect(modal.locator('.adm-fee-table')).toContainText('UPI 4567');
    const sent = api.callsTo('POST', `/api/admin/orders/${OID}/fees`)[0].body;
    expect(sent).toMatchObject({ amount: '3000', reference: 'UPI 4567' });
    expect(sent.received_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('the deal can be marked completed, or the sale cancelled when the winner withdraws', async ({ page }) => {
    const api = await mockApi(page);
    api.signIn(USERS.admin);
    let current = deal({ status: 'awaiting_payment' });
    api.state.data.set('/api/admin/results', [base]);
    api.override(`GET /api/admin/results/${AID}`, () => api.json(200, detail(current)));
    api.override(`POST /api/admin/orders/${OID}/cancel`, ({ body }) => {
      current = deal({ status: 'cancelled', status_reason: body.reason, closed_at: new Date().toISOString() });
      return api.json(200, { id: OID, status: 'cancelled' });
    });
    api.override(`POST /api/admin/orders/${OID}/complete`, ({ body }) => {
      current = deal({ status: 'paid', status_reason: body.reason || 'Deal completed', closed_at: new Date().toISOString() });
      return api.json(200, current);
    });

    await open(page, `/admin?tab=results&status=sold&open=${AID}`);
    const card = page.locator('.adm-deal');
    await expect(card).toContainText('In progress');
    // cancel needs a reason
    await card.getByRole('button', { name: 'Cancel sale' }).click();
    const confirm = page.getByRole('dialog', { name: 'Cancel sale' });
    await confirm.getByRole('button', { name: 'Cancel sale' }).click();
    await expect(confirm).toContainText('Please write a reason');
    await confirm.locator('textarea').fill('Winner withdrew');
    await confirm.getByRole('button', { name: 'Cancel sale' }).click();
    await expect(card).toContainText('Sale cancelled');
    await expect(card).toContainText('Winner withdrew');
    await expect(card).toContainText('Auctions > Waiting');
    await expect(card.getByRole('button', { name: 'Mark deal completed' })).toHaveCount(0);
    expect(api.callsTo('POST', `/api/admin/orders/${OID}/cancel`)[0].body).toEqual({ reason: 'Winner withdrew' });

    // the other way: completed
    current = deal({ status: 'awaiting_payment' });
    await open(page, `/admin?tab=results&status=sold&open=${AID}`);
    await page.locator('.adm-deal').getByRole('button', { name: 'Mark deal completed' }).click();
    await page.getByRole('dialog', { name: 'Mark deal completed' }).getByRole('button', { name: 'Mark completed' }).click();
    await expect(page.locator('.adm-deal')).toContainText('Deal completed');
    await expect(page.locator('.adm-deal').getByRole('button', { name: 'Cancel sale' })).toHaveCount(0);
  });

  test('monthly report shows totals, the three lists and an Excel link', async ({ page }) => {
    const api = await mockApi(page);
    api.signIn(USERS.admin);
    api.override('GET /api/admin/reports/monthly', ({ query }) => api.json(200, {
      month: new URLSearchParams(query).get('month'), label: 'October 2026',
      totals: { vehicles_uploaded: 12, buyers_registered: 30, deals: 1, approved_amount: '501000.00', service_fee: '5000.00',
        fee_received: '3000.00', fee_pending: '2000.00' },
      payments: [{ order_id: OID, order_number: 'ORD-2026-000002', auction_id: AID, claim_number: 'CLM-2026-0442',
        vehicle: '2020 Honda City V CVT', registration_number: 'KL01MN7891', approved_amount: '501000.00',
        approved_at: '2026-10-24T06:30:00Z', buyer_name: 'Shadin Muhammed', buyer_id: 'SLX-000005', buyer_mobile: '+91 98470 12345',
        service_fee: '5000.00', fee_received: '3000.00', fee_pending: '2000.00', fee_received_on: '2026-10-25', references: 'UPI 4567' }],
      vehicles: [{ vehicle_id: 'v1', added_at: '2026-10-20T06:00:00Z', claim_number: 'CLM-2026-0442', registration_number: 'KL01MN7891',
        vehicle: '2020 Honda City V CVT', category: 'Insurance', location: 'Kochi Yard', status: 'approved' }],
      buyers: [{ user_id: 'u1', buyer_id: 'SLX-000005', name: 'Shadin Muhammed', email: 'shadin@example.com',
        mobile: '+91 98470 12345', kyc_status: 'verified', is_active: true, registered_at: '2026-10-21T06:00:00Z' }],
    }));

    await open(page, '/admin?tab=reports&month=2026-10');
    await expect(page.locator('.adm-report-title')).toHaveText('October 2026');
    expect(api.callsTo('GET', '/api/admin/reports/monthly')[0].query).toContain('month=2026-10');
    await expect(page.locator('.adm-report-tiles')).toContainText('₹2,000');
    const row = page.locator('tbody tr').first();
    await expect(row).toContainText('CLM-2026-0442');
    await expect(row).toContainText('SLX-000005');
    await expect(row).toContainText('UPI 4567');
    await expect(page.getByRole('link', { name: 'Download Excel' })).toHaveAttribute('href', /reports\/monthly\/export\?month=2026-10&section=payments/);

    // without a month in the link the report opens on the running month; arrows and "Last month" switch it
    const now = new Date();
    const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    await open(page, '/admin?tab=reports');
    await expect.poll(() => api.callsTo('GET', '/api/admin/reports/monthly').at(-1).query).toContain(`month=${key(now)}`);
    await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled();
    await page.getByRole('button', { name: 'Last month' }).click();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    await expect.poll(() => api.callsTo('GET', '/api/admin/reports/monthly').at(-1).query).toContain(`month=${key(prev)}`);
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect.poll(() => api.callsTo('GET', '/api/admin/reports/monthly').at(-1).query).toContain(`month=${key(now)}`);

    await page.getByRole('button', { name: /Buyers registered/ }).click();
    await expect(page.locator('tbody tr').first()).toContainText('shadin@example.com');
    await expect(page.getByRole('link', { name: 'Download Excel' })).toHaveAttribute('href', /section=buyers/);
    await page.getByRole('button', { name: /Payments & fees/ }).click();

    // a row opens that result
    await page.locator('tbody tr').first().click();
    await expect(page).toHaveURL(new RegExp(`tab=results&status=sold&open=${AID}`));
  });
});

test('the buyer sees Completed or Cancelled on the won vehicle', async ({ page }) => {
  const api = await mockApi(page);
  api.signIn(USERS.bidder);
  const order = (id, status, title, reason) => ({
    id, number: `ORD-2026-00000${id.slice(-1)}`, status, amount: '75000.00', due_at: null, auction_id: id, vehicle_id: id,
    vehicle_title: title, registration_number: 'KL07AB1234', payment_method: null, utr: null, payment_submitted_at: null,
    paid_at: null, status_reason: reason, created_at: '2026-10-24T09:00:00Z', bank: null, server_time: new Date().toISOString(),
    online_payment: false, approved_amount: '75000.00', service_fee: null, fee_received: '0.00', fee_pending: null,
  });
  api.override('GET /api/orders/mine', () => api.json(200, [
    order('00000000-0000-4000-8000-000000000001', 'paid', '2019 Maruti Swift VXi', 'Deal completed'),
    order('00000000-0000-4000-8000-000000000002', 'cancelled', '2020 Honda City ZX', 'Winner withdrew'),
  ]));
  await open(page, '/dashboard?tab=won');
  // no online payment: the tab does not ask the buyer to pay
  await expect(page.locator('.tab-pane-header')).toContainText('You do not pay on the website');
  await expect(page.locator('.tab-pane-header')).not.toContainText('Pay each win');
  const done = page.locator('.order-card', { hasText: '2019 Maruti Swift VXi' });
  await expect(done.locator('.order-status')).toHaveText('Completed');
  await expect(done).toContainText('Your purchase is complete');
  const cancelled = page.locator('.order-card', { hasText: '2020 Honda City ZX' });
  await expect(cancelled.locator('.order-status')).toHaveText('Cancelled');
  await expect(cancelled).toContainText('Winner withdrew');
});
