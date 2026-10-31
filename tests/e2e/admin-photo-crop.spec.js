// Admin photos are cropped to a square (1:1) before upload; an existing photo can be cropped again.
import { test, expect } from '@playwright/test';
import zlib from 'node:zlib';
import { mockApi, open, USERS } from './helpers/mockApi';

const VID = '22222222-3333-4444-8555-666666666666';

/** A solid-colour PNG of the given size. */
function png(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x60)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Width and height of a JPEG (from its SOF marker). */
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

test.describe('admin photo crop', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop admin flow');

  test('new photos are cropped to 1:1; "crop the rest from the centre"; an existing photo can be cropped again', async ({ page }) => {
    const api = await mockApi(page);
    api.signIn(USERS.admin);
    let photos = [];
    const vehicle = () => ({
      id: VID, status: 'draft', category: 'insurance', listing_type: 'ready_to_lift', registration_number: 'KL07AB1234', claim_number: 'C1',
      make: 'Maruti Suzuki', model: 'Swift', variant: 'VXi', manufacturing_year: 2019, registration_year: 2019, fuel_type: 'petrol',
      transmission: 'manual', number_of_owners: 1, damage_type: 'accident', damage_other: null, location: 'Kochi', rc_status: 'available',
      registration_type: 'private', hypothecation_status: 'not_hypothecated', km_driven: 100, superdari: false, sold_at: null,
      owner_id: USERS.admin.id, created_at: '2026-10-25T05:00:00Z', submitted_at: null, reviewed_at: null, review_reason: null, photos,
    });
    api.override(`GET /api/admin/vehicles/${VID}`, () => api.json(200, vehicle()));
    const uploaded = [];
    await page.route(`**/api/vehicles/${VID}/photos`, async (route) => {
      const body = route.request().postDataBuffer();
      uploaded.push(jpegSize(body));
      const p = { id: `0000000${photos.length + 1}-0000-4000-8000-00000000000${photos.length + 1}`, content_type: 'image/jpeg', size_bytes: body.length,
        uploaded_at: new Date().toISOString(), position: photos.length };
      photos = [...photos, p];
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(p) });
    });
    await page.route(new RegExp(`/api/vehicles/${VID}/photos/[^/]+(\\?size=\\w+)?$`), async (route) => {
      if (route.request().url().endsWith('/order')) return route.fallback();       // the photo order goes to the fake API
      if (route.request().method() === 'DELETE') {
        const id = route.request().url().split('/').pop();
        photos = photos.filter((p) => p.id !== id);
        return route.fulfill({ status: 204, body: '' });
      }
      return route.fulfill({ status: 200, contentType: 'image/png', body: png(300, 150) });
    });
    api.override(`PUT /api/vehicles/${VID}/photos/order`, ({ body }) => {
      photos = body.photo_ids.map((id) => photos.find((p) => p.id === id));
      return api.json(200, photos);
    });

    await open(page, `/admin?tab=ready-to-lift&status=draft&open=${VID}`);
    const modal = page.getByRole('dialog', { name: /KL07AB1234/ });
    await modal.getByLabel('Add photos', { exact: true }).setInputFiles([
      { name: 'wide.png', mimeType: 'image/png', buffer: png(400, 200) },
      { name: 'tall.png', mimeType: 'image/png', buffer: png(150, 300) },
      { name: 'third.png', mimeType: 'image/png', buffer: png(500, 250) },
    ]);
    const cropper = page.getByRole('dialog', { name: /Crop photo \(1:1\) · 1 of 3/ });
    await expect(cropper.locator('.adm-crop-frame img')).toBeVisible();
    // zoom in and move a little, then crop
    await cropper.getByRole('button', { name: 'Zoom in' }).click();
    await cropper.locator('.adm-crop-frame').focus();
    await page.keyboard.press('ArrowLeft');
    await cropper.getByRole('button', { name: 'Crop and use' }).click();
    // the second one is skipped, the rest is cropped from the centre
    await page.getByRole('dialog', { name: /2 of 3/ }).getByRole('button', { name: 'Skip this photo' }).click();
    await page.getByRole('dialog', { name: /3 of 3/ }).getByRole('button', { name: 'Crop and use' }).click();
    await expect.poll(() => uploaded.length).toBe(2);
    for (const size of uploaded) expect(size.width).toBe(size.height);      // square
    // Esc in the cropper must not close the vehicle window under it
    await expect(modal).toBeVisible();

    // crop an existing photo again: a new square photo takes its place
    await expect(modal.locator('.adm-photos figure')).toHaveCount(2);
    await modal.getByRole('button', { name: 'Crop photo 1' }).click();
    const again = page.getByRole('dialog', { name: /Crop photo 1/ });
    await expect(again.locator('.adm-crop-frame img')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(again).toHaveCount(0);
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'Crop photo 1' }).click();
    await page.getByRole('dialog', { name: /Crop photo 1/ }).getByRole('button', { name: 'Crop and use' }).click();
    await expect.poll(() => uploaded.length).toBe(3);
    expect(uploaded[2].width).toBe(uploaded[2].height);
    await expect.poll(() => api.callsTo('PUT', `/api/vehicles/${VID}/photos/order`).length).toBe(1);
    expect(photos[0].id).toBe('00000003-0000-4000-8000-000000000003');          // the new crop is the cover again
  });
});
