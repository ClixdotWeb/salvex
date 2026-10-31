// A vehicle sold in an auction: an old link still opens and says "Sold"; an unsold one says the next auction is coming.
import { test, expect } from '@playwright/test';
import { mockApi, open } from './helpers/mockApi';

const VID = '15151515-1515-4515-8515-151515151515';
const vehicle = (over) => ({
  id: VID, category: 'insurance', listing_type: 'auction', make: 'Volkswagen', model: 'Polo', variant: 'Highline',
  manufacturing_year: 2018, registration_year: 2018, registration_masked: 'KL09**9012', fuel_type: 'petrol', transmission: 'manual',
  number_of_owners: 1, damage_type: 'accident', damage_other: null, location: 'Kochi Yard', rc_status: 'available',
  registration_type: 'private', hypothecation_status: 'not_hypothecated', km_driven: null, superdari: null, sold_at: null,
  photo_ids: [], auction: null, sold: false, ...over,
});

test('a sold vehicle says Sold; an unsold one says the next auction is coming', async ({ page }) => {
  const api = await mockApi(page);
  let current = vehicle({ sold: true });
  api.override(`GET /api/catalogue/vehicles/${VID}`, () => api.json(200, current));

  await open(page, `/vehicles/${VID}`);
  await expect(page.locator('.pub-sold-state')).toContainText('This vehicle has been sold');
  await expect(page.getByText('coming soon')).toHaveCount(0);

  current = vehicle();
  await page.reload();
  await expect(page.getByText('The next auction for this vehicle is coming soon')).toBeVisible();
  await expect(page.locator('.pub-sold-state')).toHaveCount(0);
});
