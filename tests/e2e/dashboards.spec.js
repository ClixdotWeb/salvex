// The redesigned dashboards: same figures and links, new layout.
import { test, expect } from '@playwright/test';
import { mockApi, open, USERS } from './helpers/mockApi';

test('buyer dashboard: welcome, the four figures, bids and the Ready to Lift card', async ({ page }) => {
  const api = await mockApi(page);
  api.signIn({ ...USERS.bidder, kyc_status: 'pending', buyer_id: 'SLX-000005' });
  api.state.data.set('/api/bids/mine', [{ auction_id: '00000001-0000-4000-8000-000000000001', vehicle_id: '10000001-0000-4000-8000-000000000001',
    photo_id: null, title: '2019 Maruti Suzuki Swift VXi', registration_masked: 'KL07**1234', my_highest_bid: '58000.00',
    current_price: '61000.00', you_are_highest: false, you_won: false, phase: 'live' }]);
  await open(page, '/dashboard');
  await expect(page.locator('.bd-welcome')).toContainText('SLX-000005');
  await expect(page.locator('.bd-welcome')).toContainText('Verify your identity');
  await expect(page.locator('.bd-stat')).toHaveCount(4);
  await expect(page.locator('.bd-stat', { hasText: 'Outbid' })).toContainText('1');
  await expect(page.locator('.bd-bid-row')).toContainText('Bid again');
  await expect(page.locator('.bd-promo').getByRole('link', { name: 'View vehicles' })).toHaveAttribute('href', '/ready-to-lift');
  await page.locator('.bd-welcome').getByRole('button', { name: 'Complete KYC' }).click();
  await expect(page).toHaveURL(/tab=documents/);
  await expect(page.locator('.bd-top h1')).toHaveText('KYC & documents');
});

test.describe('admin dashboard', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop admin layout');

  test('greeting, live card, attention cards and quick actions open the right window', async ({ page }) => {
    const api = await mockApi(page);
    api.signIn(USERS.admin);
    api.override('GET /api/admin/dashboard', () => api.json(200, {
      kyc_waiting_review: 3, vehicles_waiting_review: 0, deals_fee_pending: 1, enquiries_new: 4, part_requests_new: 0, contact_messages_new: 0,
      ready_to_lift_available: 6, auctions_live: 3, auctions_upcoming: 5, auctions_paused: 0, bids_today: 27, vehicles_approved: 40,
      users_total: 120, bidders: 118, sellers: 0, suspended_users: 1, online_payment: false, auctions_awaiting_close: 0,
      orders_awaiting_payment: 0, payments_to_confirm: 0, server_time: new Date().toISOString(),
    }));
    await open(page, '/admin');
    await expect(page.locator('.adm-dash-welcome')).toContainText('8 things need your attention');
    await expect(page.locator('.adm-dash-live')).toContainText('27');
    await page.locator('.adm-pastel', { hasText: 'New vehicle enquiries' }).click();
    await expect(page).toHaveURL(/tab=enquiries&status=new/);

    await open(page, '/admin');
    await page.locator('.adm-dash-welcome').getByRole('button', { name: 'Bulk upload' }).click();
    await expect(page.getByRole('dialog', { name: 'Bulk upload vehicles' })).toBeVisible();
    await open(page, '/admin');
    await page.locator('.adm-dash-welcome').getByRole('button', { name: 'Add Ready to Lift' }).click();
    await expect(page.getByRole('dialog', { name: 'Add Ready to Lift vehicle' })).toBeVisible();
    await open(page, '/admin');
    await page.locator('.adm-dash-welcome').getByRole('button', { name: 'New auction' }).click();
    await expect(page.getByRole('dialog', { name: 'New auction' })).toBeVisible();
  });
});

test('the buyer dashboard has its own Sign out', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'phones sign out from the menu');
  const api = await mockApi(page);
  api.signIn({ ...USERS.bidder, kyc_status: 'verified', buyer_id: 'SLX-000005' });
  await open(page, '/dashboard');
  await page.locator('.bd-rail-signout').click();
  await expect(page.locator('.salvex-toast-notification')).toContainText('You have been signed out.');
  await expect(page.locator('#nav-avatar')).toHaveCount(0);
  expect(api.callsTo('POST', '/api/auth/logout')).toHaveLength(1);
});
