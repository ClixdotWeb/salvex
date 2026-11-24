// Contact form, Ready to Lift interest, spare-part request and the public lists. Real backend, local database.
import { test, expect } from '@playwright/test';
import { db, go, clickFor, registerBuyer, signIn, ADMIN, stamp } from './helpers';

test.skip(!ADMIN.email || !ADMIN.password, 'set SALVEX_REAL_ADMIN_EMAIL and SALVEX_REAL_ADMIN_PASSWORD (a local verification admin)');

const tag = stamp();
let buyer;

test.describe.serial('enquiries and catalogue (real backend)', () => {
  test('contact form: empty form is stopped in the browser; a real message is stored', async ({ page }) => {
    await go(page, '/contact');
    const form = page.locator('form', { has: page.locator('textarea') });
    let posted = false;
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/contact')) posted = true; });
    await form.locator('button[type="submit"]').click();
    await page.waitForTimeout(800);
    expect(posted).toBe(false);

    const email = `real.contact.${tag}@example.com`;
    await form.getByPlaceholder('Full Name *').fill('Real Contact');
    await form.getByPlaceholder('Mobile Number *').fill('+91 9876500001');
    await form.getByPlaceholder('Email Address *').fill(email);
    await form.locator('.sx-select').click();
    await page.getByRole('option', { name: 'General enquiry', exact: true }).click();
    await form.getByPlaceholder('Write Message Here… *').fill(`Real verification message ${tag}`);
    const res = await clickFor(page, form.locator('button[type="submit"]'), 'POST', '/api/contact');
    expect(res.status).toBe(201);
    const row = db('select name, subject, message, status from contact_messages where email = %s', email)[0];
    expect(row).toMatchObject({ name: 'Real Contact', subject: 'General enquiry', message: `Real verification message ${tag}` });
    test.info().annotations.push({ type: 'db', description: JSON.stringify(row) });
  });

  test('admin sees the contact message in the admin console', async ({ page }) => {
    await signIn(page, ADMIN.email, ADMIN.password);
    await go(page, '/admin?tab=messages');
    await expect(page.locator('tr', { hasText: 'Real Contact' }).first()).toBeVisible();
  });

  test('Ready to Lift: signed out the button asks to sign in; signed in the interest is stored once', async ({ page }) => {
    const listed = db("select count(*)::int n from vehicles where listing_type = 'ready_to_lift' and status = 'approved'")[0].n;
    await go(page, '/ready-to-lift');
    const buttons = page.getByRole('link', { name: "I'm interested" });
    await expect(buttons.first()).toBeVisible();
    expect(await buttons.count()).toBe(listed);                                    // the page lists what the DB has

    buyer = await registerBuyer(page, 'enquirer');
    await go(page, '/ready-to-lift');
    await page.getByRole('button', { name: "I'm interested" }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Confirm your interest' });
    await expect(dialog.getByRole('button', { name: 'Send my interest' })).toBeDisabled();
    await dialog.locator('input[type="checkbox"]').check();
    const res = await clickFor(page, dialog.getByRole('button', { name: 'Send my interest' }), 'POST', '/interest');
    expect(res.status).toBe(201);
    const rows = db('select e.status from vehicle_enquiries e join users u on u.id = e.user_id where u.email = %s', buyer.email);
    expect(rows).toHaveLength(1);
    await page.reload();
    await expect(page.getByRole('button', { name: "I'm interested" })).toHaveCount(listed - 1);   // the requested one changed state
  });

  test('spare part request: stored with the buyer and shown in their dashboard after a reload', async ({ page }) => {
    await signIn(page, buyer.email, buyer.password);
    await go(page, '/spare-parts');
    await page.getByRole('button', { name: /Request this part/ }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Request a part' });
    const fill = async (label, value) => { const f = dialog.locator('label', { hasText: label }).locator('input'); if (await f.count()) await f.fill(value); };
    await fill('Vehicle make', 'Maruti');
    await fill('Model', 'Swift');
    await fill('Part needed', `Headlamp ${tag}`);
    await fill('Your phone number', '+91 9876500002');
    const res = await clickFor(page, dialog.getByRole('button', { name: /Send request/ }), 'POST', '/api/part-requests');
    expect(res.status).toBe(201);
    const row = db('select r.number, r.part_name, r.contact_phone from part_requests r join users u on u.id = r.user_id where u.email = %s', buyer.email)[0];
    expect(row.part_name).toContain(tag);
    await expect(dialog.getByText(row.number)).toBeVisible();
    await go(page, '/dashboard?tab=parts');
    await expect(page.getByText(row.number).first()).toBeVisible();
  });

  test('admin sees the Ready to Lift enquiry and the part request', async ({ page }) => {
    await signIn(page, ADMIN.email, ADMIN.password);
    await go(page, '/admin?tab=enquiries');
    await expect(page.locator('tr', { hasText: 'Real enquirer' }).first()).toBeVisible();
    await go(page, '/admin?tab=part-enquiries');
    await expect(page.getByText(`Headlamp ${tag}`).first()).toBeVisible();
  });

  test('public lists show what the database holds: live auctions, spare parts, search', async ({ page }) => {
    const live = db("select count(*)::int n from auctions where status = 'scheduled' and starts_at <= now() and ends_at > now()")[0].n;
    const api = await (await page.request.get('/api/auctions?phase=live&page=1&page_size=50')).json();
    test.info().annotations.push({ type: 'live auctions', description: `db=${live} api=${api.total}` });
    expect(api.total).toBe(live);
    const parts = db('select count(*)::int n from spare_parts where is_active')[0].n;
    const p = await (await page.request.get('/api/parts?page=1&page_size=50')).json();
    expect(p.total).toBe(parts);
    await go(page, '/search?q=Swift');
    await expect(page.getByText(/Swift/).first()).toBeVisible();
  });
});
