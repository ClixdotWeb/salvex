// The themed date-time picker on the auction settings (instead of the browser's default calendar).
import { test, expect } from '@playwright/test';
import { mockApi, open, USERS } from './helpers/mockApi';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const VID = '20202020-2020-4020-8020-202020202020';
const vehicle = {
  id: VID, status: 'approved', category: 'insurance', listing_type: 'auction', registration_number: 'KL07AB1234', make: 'Maruti Suzuki',
  model: 'Swift', variant: 'VXi', manufacturing_year: 2019, location: 'Kochi Yard', owner_id: USERS.admin.id,
  created_at: '2026-10-25T05:00:00Z', submitted_at: null, cover_photo_id: null, sold_at: null,
};

test('choose start and end with the calendar and time controls', async ({ page, isMobile }) => {
  const api = await mockApi(page);
  api.signIn(USERS.admin);
  api.override('GET /api/admin/vehicles', () => api.json(200, { items: [vehicle], page: 1, page_size: 25, total: 1, pages: 1 }));
  let sent = null;
  api.override('POST /api/admin/auctions', ({ body }) => { sent = body; return api.json(201, { id: '21212121-2121-4121-8121-212121212121', vehicle_id: VID, ...body }); });

  await open(page, '/admin?tab=auctions&status=waiting');
  await page.getByRole('button', { name: 'Start auction' }).click();
  const modal = page.getByRole('dialog', { name: 'New auction' });
  await expect(modal.locator('input[type="datetime-local"]')).toHaveCount(0);           // no browser default calendar

  // Starts: tomorrow, 10:00 AM via the quick chip, then 10:30 with the minutes arrows
  await modal.getByRole('button', { name: 'Starts' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose date and time' });
  await expect(picker).toBeVisible();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (tomorrow.getMonth() !== new Date().getMonth()) await picker.getByRole('button', { name: 'Next month' }).click();
  await picker.locator(`[data-date="${iso(tomorrow)}"]`).click();
  await picker.getByRole('button', { name: '10:00 AM' }).click();
  // minutes change one by one, and can be typed
  await picker.getByRole('button', { name: 'Minutes up' }).click();
  await expect(picker.getByLabel('Minutes', { exact: true })).toHaveValue('01');
  await picker.getByRole('button', { name: 'Minutes down' }).click();
  await expect(picker.getByLabel('Minutes', { exact: true })).toHaveValue('00');
  await picker.getByLabel('Minutes', { exact: true }).fill('29');
  await expect(picker.getByLabel('Minutes', { exact: true })).toHaveValue('29');
  await picker.getByLabel('Minutes', { exact: true }).press('ArrowUp');
  await expect(picker.getByLabel('Minutes', { exact: true })).toHaveValue('30');
  // days before today cannot be chosen
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (yesterday.getMonth() === tomorrow.getMonth()) {
    await expect(picker.locator(`[data-date="${iso(yesterday)}"]`)).toBeDisabled();
  }
  await picker.getByRole('button', { name: 'Done' }).click();
  await expect(picker).toHaveCount(0);
  await expect(modal.getByRole('button', { name: 'Starts' })).toContainText('10:30 AM');

  // Ends: same day, 2 PM with the PM switch
  await modal.getByRole('button', { name: 'Ends' }).click();
  await picker.locator(`[data-date="${iso(tomorrow)}"]`).click();
  await picker.getByRole('button', { name: '12:00 PM' }).click();
  for (let i = 0; i < 2; i += 1) await picker.getByRole('button', { name: 'Hour up' }).click();
  await picker.getByRole('button', { name: 'Done' }).click();
  await expect(modal.getByRole('button', { name: 'Ends' })).toContainText('2:00 PM');

  await modal.locator('.adm-field', { hasText: 'Starting price' }).locator('input').fill('50000');
  await modal.getByRole('button', { name: 'Create auction' }).click();
  await expect.poll(() => sent).not.toBeNull();
  const start = new Date(sent.starts_at);
  const end = new Date(sent.ends_at);
  expect([start.getHours(), start.getMinutes(), end.getHours(), end.getMinutes()]).toEqual([10, 30, 14, 0]);
  expect(start.getDate()).toBe(tomorrow.getDate());
  if (isMobile) await expect(page.locator('.sx-dtp-panel')).toHaveCount(0);
});

test('moving Starts past Ends moves Ends with it; a past time today is not kept', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop admin flow');
  const api = await mockApi(page);
  api.signIn(USERS.admin);
  api.override('GET /api/admin/vehicles', () => api.json(200, { items: [vehicle], page: 1, page_size: 25, total: 1, pages: 1 }));
  let sent = null;
  api.override('POST /api/admin/auctions', ({ body }) => { sent = body; return api.json(201, { id: '21212121-2121-4121-8121-212121212121', vehicle_id: VID, ...body }); });
  await open(page, '/admin?tab=auctions&status=waiting');
  await page.getByRole('button', { name: 'Start auction' }).click();
  const modal = page.getByRole('dialog', { name: 'New auction' });
  const picker = page.getByRole('dialog', { name: 'Choose date and time' });

  // today at 12:00 AM is in the past: it is moved up to now
  await modal.getByRole('button', { name: 'Starts' }).click();
  await picker.locator(`[data-date="${iso(new Date())}"]`).click();
  await picker.getByLabel('Hour', { exact: true }).fill('12');
  await picker.getByRole('button', { name: 'AM', exact: true }).click();
  await picker.getByLabel('Minutes', { exact: true }).fill('00');
  await picker.getByRole('button', { name: 'Done' }).click();

  // Starts in 5 days: Ends (tomorrow by default) moves after it
  const later = new Date();
  later.setDate(later.getDate() + 5);
  await modal.getByRole('button', { name: 'Starts' }).click();
  if (later.getMonth() !== new Date().getMonth()) await picker.getByRole('button', { name: 'Next month' }).click();
  await picker.locator(`[data-date="${iso(later)}"]`).click();
  await picker.getByRole('button', { name: 'Done' }).click();

  await modal.locator('.adm-field', { hasText: 'Starting price' }).locator('input').fill('50000');
  await modal.getByRole('button', { name: 'Create auction' }).click();
  await expect.poll(() => sent).not.toBeNull();
  expect(new Date(sent.ends_at) > new Date(sent.starts_at)).toBe(true);
  expect(new Date(sent.starts_at).getDate()).toBe(later.getDate());
});
