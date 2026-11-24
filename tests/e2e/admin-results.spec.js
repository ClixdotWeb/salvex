// Admin Results: the list of finished auctions and one result with the winner's details.
import { test, expect } from '@playwright/test';
import { mockApi, open, USERS } from './helpers/mockApi';

const AID = '77777777-7777-4777-8777-777777777777';
const ROW = {
  auction_id: AID, vehicle_id: '88888888-8888-4888-8888-888888888888', vehicle_title: '2019 Maruti Suzuki Swift VXi',
  registration_number: 'KL07AB1234', category: 'insurance', result: 'sold', starting_price: '50000.00',
  winning_amount: '61500.00', bid_count: 7, closed_at: '2026-10-24T09:00:00Z', winner_id: USERS.bidder.id,
  winner_name: 'Faheem K', winner_email: 'faheem@example.com', winner_mobile: '+91 98765 43210',
  order_id: '99999999-9999-4999-8999-999999999999', order_number: 'ORD-2026-000001', order_status: 'awaiting_payment',
};
const DETAIL = {
  ...ROW, location: 'Kochi Yard', starts_at: '2026-10-24T07:00:00Z', ends_at: '2026-10-24T09:00:00Z',
  winner_organization: 'FK Motors', winner_kyc_status: 'verified', winner_since: '2026-10-20T10:00:00Z', winner_is_active: true,
  order_due_at: '2026-10-26T09:00:00Z', order_utr: null, order_payment_submitted_at: null, order_paid_at: null,
  top_bids: [
    { bidder_name: 'Faheem K', bidder_email: 'faheem@example.com', amount: '61500.00', created_at: '2026-10-24T08:59:00Z' },
    { bidder_name: 'Asha B', bidder_email: 'asha@example.com', amount: '60000.00', created_at: '2026-10-24T08:50:00Z' },
  ],
};

test('admin sees who won and for how much', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop admin flow');
  const api = await mockApi(page);
  api.signIn(USERS.admin);
  api.state.data.set('/api/admin/results', [ROW]);
  api.override(`GET /api/admin/results/${AID}`, () => api.json(200, DETAIL));

  await open(page, '/admin?tab=results');
  const row = page.locator('tr', { hasText: '2019 Maruti Suzuki Swift VXi' });
  await expect(row).toContainText('₹61,500');
  await expect(row).toContainText('Faheem K');
  await expect(row).toContainText('Fee not set');
  await row.click();

  const modal = page.getByRole('dialog');
  await expect(modal.locator('.adm-result-banner')).toContainText('Sold for ₹61,500');
  await expect(modal).toContainText('faheem@example.com');
  await expect(modal).toContainText('FK Motors');
  await expect(modal.locator('tbody tr')).toHaveCount(2);
  // contact the winner by phone or WhatsApp; no email button (it needs a mail app on the computer)
  await expect(modal.getByRole('link', { name: /Call/ })).toHaveAttribute('href', /^tel:\+?91/);
  await expect(modal.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', /^https:\/\/wa\.me\/91\d+$/);
  await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('result.png') });
});


test('clicking an admin notification opens that very record, and closing it keeps the list', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop admin flow');
  const api = await mockApi(page);
  api.signIn(USERS.admin);
  api.state.data.set('/api/admin/results', [{ ...ROW, result: 'no_sale', winning_amount: null, winner_id: null, winner_name: null,
    winner_email: null, winner_mobile: null, order_id: null, order_number: null, order_status: null }]);
  api.override(`GET /api/admin/results/${AID}`, () => api.json(200, { ...DETAIL, result: 'no_sale', winning_amount: null, winner_id: null,
    winner_name: null, order_id: null, order_number: null, order_status: null, top_bids: [] }));
  api.override('GET /api/notifications/unread-count', () => api.json(200, { unread: 1 }));
  api.state.data.set('/api/notifications', [{
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kind: 'auction_no_sale', title: '2019 Maruti Suzuki Swift VXi (KL07AB1234): no sale',
    body: 'The auction ended without any bid.', link: `/admin?tab=results&status=no_sale&open=${AID}`,
    read_at: null, created_at: new Date().toISOString(),
  }]);
  api.override('POST /api/notifications/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/read', () => api.json(200, {}));

  await open(page, '/admin');
  await page.getByRole('button', { name: /Notifications/ }).click();
  await page.getByText('no sale', { exact: false }).first().click();

  // the "No sale" filter is selected and the result is open
  await expect(page).toHaveURL(/tab=results&status=no_sale&open=/);
  const modal = page.getByRole('dialog');
  await expect(modal.locator('.adm-result-banner')).toContainText('Ended without a sale');
  await expect(page.locator('.adm-tabs button.active')).toHaveText('No sale');

  // closing removes "open" but stays on the same list
  await modal.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/tab=results&status=no_sale$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.adm-tabs button.active')).toHaveText('No sale');
});
