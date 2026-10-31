// Admin search: Buyer ID / name / phone finds people, registration / claim number finds vehicles; full overviews.
import { test, expect } from '@playwright/test';
import { mockApi, open, USERS } from './helpers/mockApi';

const BUYER = '31313131-3131-4131-8131-313131313131';
const VID = '32323232-3232-4232-8232-323232323232';
const AID = '33333333-3434-4434-8434-343434343434';
const buyerHit = { id: BUYER, buyer_id: 'SLX-000005', name: 'Shadin Muhammed', email: 'shadin@example.com', mobile: '+91 98470 12345',
  role: 'bidder', kyc_status: 'verified', is_active: true };
const vehicleHit = { id: VID, title: '2019 Maruti Suzuki Swift VXi', registration_number: 'KL07AB1234', claim_number: 'CLM-2026-0101',
  listing_type: 'auction', status: 'approved', location: 'Kochi Yard', sold: true, cover_photo_id: null };
const deal = { order_id: '35353535-3535-4535-8535-353535353535', order_number: 'ORD-2026-000002', approved_amount: '75000.00',
  service_fee: '5000.00', fee_received: '3000.00', fee_pending: '2000.00' };
const buyerOverview = {
  ...buyerHit, organization: '', is_email_verified: true, created_at: '2026-10-20T05:00:00Z', kyc_submission_id: null, kyc_submitted_at: null,
  bids_total: 4, auctions_bid_on: 2,
  won: [{ auction_id: AID, vehicle_id: VID, vehicle_title: vehicleHit.title, registration_number: 'KL07AB1234', amount: '75000.00',
    closed_at: '2026-10-24T09:00:00Z', deal }],
  recent_bids: [{ auction_id: AID, vehicle_title: vehicleHit.title, registration_number: 'KL07AB1234', amount: '75000.00',
    created_at: '2026-10-24T08:59:00Z', auction_phase: 'ended' }],
  vehicle_enquiries: [{ id: '36363636-3636-4636-8636-363636363636', number: 'ENQ-2026-000001', what: '2020 Hyundai i20 (KL01CD5678)',
    status: 'new', created_at: '2026-10-25T05:00:00Z' }],
  part_enquiries: [],
};
const vehicleOverview = {
  vehicle: { id: VID, status: 'approved', category: 'insurance', listing_type: 'auction', registration_number: 'KL07AB1234',
    claim_number: 'CLM-2026-0101', make: 'Maruti Suzuki', model: 'Swift', variant: 'VXi', manufacturing_year: 2019, registration_year: 2019,
    fuel_type: 'petrol', transmission: 'manual', number_of_owners: 1, km_driven: null, superdari: null, damage_type: 'accident',
    damage_other: null, location: 'Kochi Yard', rc_status: 'available', registration_type: 'private', hypothecation_status: 'not_hypothecated',
    owner_id: USERS.admin.id, created_at: '2026-10-20T05:00:00Z', photos: [], sold_at: null },
  sold: true,
  auctions: [{ auction_id: AID, phase: 'ended', status: 'closed', result: 'sold', starting_price: '50000.00', current_price: '75000.00',
    bid_count: 4, starts_at: '2026-10-24T07:00:00Z', ends_at: '2026-10-24T09:00:00Z', winner_id: BUYER, winner_name: 'Shadin Muhammed',
    winner_buyer_id: 'SLX-000005', winner_mobile: '+91 98470 12345', deal }],
  enquiries: [],
};

test.describe('admin search', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop admin layout');

  test('find a buyer by Buyer ID and a vehicle by registration; open their full details', async ({ page }) => {
    const api = await mockApi(page);
    api.signIn(USERS.admin);
    api.override('GET /api/admin/search', ({ query }) => {
      const q = new URLSearchParams(query).get('q').toUpperCase().replace(/[^A-Z0-9]/g, '');
      return api.json(200, { q, buyers: q.includes('SLX') || q === '5' ? [buyerHit] : [], vehicles: q.includes('KL07') || q.includes('CLM') ? [vehicleHit] : [] });
    });
    api.override(`GET /api/admin/users/${BUYER}/overview`, () => api.json(200, buyerOverview));
    api.override(`GET /api/admin/vehicles/${VID}/overview`, () => api.json(200, vehicleOverview));

    await open(page, '/admin');
    const box = page.getByRole('textbox', { name: 'Search buyers and vehicles' });
    await box.fill('slx-000005');
    const results = page.getByRole('listbox', { name: 'Search results' });
    await expect(results).toContainText('Shadin Muhammed');
    await results.getByRole('option').first().click();

    const buyer = page.getByRole('dialog', { name: /Shadin Muhammed · SLX-000005/ });
    await expect(buyer).toContainText('+91 98470 12345');
    await expect(buyer.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:+919847012345');
    await expect(buyer.locator('.adm-ov-stats')).toContainText('4bids');
    await expect(buyer).toContainText('ENQ-2026-000001');
    await expect(buyer).toContainText('pending ₹2,000');
    await page.keyboard.press('Escape');

    // a registration number with spaces, Enter opens the first result
    await box.fill('kl 07 ab 1234');
    await expect(results).toContainText('KL07AB1234 · CLM-2026-0101');
    await box.press('Enter');
    const vehicle = page.getByRole('dialog', { name: /Swift VXi · KL07AB1234/ });
    await expect(vehicle).toContainText('CLM-2026-0101');
    await expect(vehicle.locator('.adm-badges')).toContainText('Sold');
    // from the vehicle to its winner
    await vehicle.getByRole('button', { name: 'Shadin Muhammed · SLX-000005' }).click();
    await expect(page.getByRole('dialog', { name: /Shadin Muhammed · SLX-000005/ })).toBeVisible();
    // and to the deal of the won auction
    await page.getByRole('dialog').getByRole('button', { name: 'Deal' }).click();
    await expect(page).toHaveURL(new RegExp(`tab=results&status=sold&open=${AID}`));
  });
});
