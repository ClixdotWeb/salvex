// Account journey against the REAL backend and local database (nothing mocked).
// SMS and email codes are read from the developer outbox: this proves the code checks, not delivery.
import { test, expect } from '@playwright/test';
import { db, lastCode, outboxSize, recordApi, go, stamp, clickFor } from './helpers';

const id = stamp();
const EMAIL = `real.buyer.${id}@example.com`;
const MOBILE = `+91 9${String(Date.now()).slice(-9)}`;
const PASSWORD = 'Maple-Tree-Walks-12';
const NEW_PASSWORD = 'River-Stone-Bridge-34';
const user = () => db('select id, name, organization, mobile, is_email_verified, is_mobile_verified, password_hash, role from users where email = %s', EMAIL)[0];
const submit = (page) => page.locator('form button[type="submit"]').first();

async function signIn(page, password = PASSWORD) {
  await go(page, '/login');
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-pass', password);
  return clickFor(page, submit(page), 'POST', '/api/auth/login');
}

test.describe.serial('account (real backend)', () => {
  test('register: invalid form never reaches the server; a valid one stores an unverified account', async ({ page }) => {
    const api = recordApi(page);
    await go(page, '/register');
    await submit(page).click();
    await page.fill('#reg-email', 'not-an-email');
    await submit(page).click();
    expect(api.last('POST', '/api/auth/register')).toBeUndefined();

    await page.fill('#reg-name', 'Real Buyer');
    await page.fill('#reg-email', EMAIL);
    await page.fill('#reg-password', PASSWORD);
    await page.fill('#reg-mobile', MOBILE);
    await submit(page).click();
    await expect(page).toHaveURL(/\/verify-email/);
    expect(api.last('POST', '/api/auth/register').status).toBe(201);
    const row = user();
    expect(row).toMatchObject({ role: 'bidder', is_email_verified: false, is_mobile_verified: false });
    expect(row.password_hash).not.toContain(PASSWORD);              // stored hashed
    expect(row.password_hash.startsWith('$2')).toBe(true);          // bcrypt
  });

  test('an unverified account cannot sign in', async ({ page }) => {
    const call = await signIn(page);
    test.info().annotations.push({ type: 'api', description: `POST /api/auth/login -> ${call.status} ${JSON.stringify(call.body)}` });
    expect(call.status).toBe(403);
    await expect(page).not.toHaveURL(/\/dashboard/);
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  });

  let firstCode;
  test('registering again before finishing sign-up: still one account, the newest details win, a new code is sent', async ({ page }) => {
    firstCode = lastCode(MOBILE);
    await go(page, '/register');
    await page.fill('#reg-name', 'Real Buyer');
    await page.fill('#reg-email', EMAIL);
    await page.fill('#reg-password', PASSWORD);
    await page.fill('#reg-mobile', MOBILE);
    const before = db('select password_hash from users where email = %s', EMAIL)[0].password_hash;
    await page.fill('#reg-name', 'Real Buyer Again');
    const call = await clickFor(page, submit(page), 'POST', '/api/auth/register');
    expect(call.status).toBe(201);
    expect(db('select count(*)::int n from users where email = %s', EMAIL)[0].n).toBe(1);
    expect(user().name).toBe('Real Buyer Again');
    expect(user().password_hash).not.toBe(before);                  // re-hashed (new salt) for the newest submission
  });

  test('SMS code: an old or wrong code is refused, the newest one creates the session and survives a reload', async ({ page }) => {
    await go(page, '/verify-email');
    await page.fill('#verify-email', EMAIL);
    const real = lastCode(MOBILE);
    for (const wrong of [firstCode !== real ? firstCode : '000000', real === '111111' ? '222222' : '111111']) {
      await page.fill('#verify-code', wrong);
      const bad = await clickFor(page, submit(page), 'POST', '/api/auth/verify-mobile');
      expect(bad.status).toBeGreaterThanOrEqual(400);
    }
    await expect(page.locator('[role="alert"]').first()).toBeVisible();
    expect(user().is_mobile_verified).toBe(false);

    await page.fill('#verify-code', real);
    const ok = await clickFor(page, submit(page), 'POST', '/api/auth/verify-mobile');
    expect(ok.status).toBe(200);
    await expect(page).toHaveURL(/\/dashboard/);
    expect(user().is_mobile_verified).toBe(true);
    expect(db('select count(*)::int n from auth_sessions where user_id = %s and revoked_at is null', user().id)[0].n).toBeGreaterThan(0);

    await page.reload();
    await expect(page).toHaveURL(/\/dashboard/);
    expect((await page.request.get('/api/auth/me')).status()).toBe(200);
  });

  test('email code from the dashboard: wrong code refused, right code marks the email verified', async ({ page }) => {
    const api = recordApi(page);
    await signIn(page);
    await expect(page).toHaveURL(/\/dashboard/);
    const card = page.locator('section', { has: page.locator('#ev-title') });
    await expect(card).toBeVisible();
    const before = outboxSize();
    await card.getByRole('button', { name: /Email me a code|Send a new code/ }).click();
    await expect(card.locator('input[autocomplete="one-time-code"]')).toBeVisible();
    expect(api.last('POST', '/api/auth/email/send-code').status).toBe(200);
    const real = lastCode(EMAIL, before);

    await card.locator('input[autocomplete="one-time-code"]').fill(real === '000000' ? '111111' : '000000');
    await card.getByRole('button', { name: /^Verify/ }).click();
    await expect.poll(() => api.last('POST', '/api/auth/email/verify')?.status).toBeGreaterThanOrEqual(400);
    expect(user().is_email_verified).toBe(false);

    await card.locator('input[autocomplete="one-time-code"]').fill(real);
    await card.getByRole('button', { name: /^Verify/ }).click();
    await expect.poll(() => api.last('POST', '/api/auth/email/verify')?.status).toBe(200);
    expect(user().is_email_verified).toBe(true);
    await page.reload();
    await expect(page.locator('#ev-title')).toHaveCount(0);           // card gone after reload
  });

  test('profile: changes are saved to the database and shown again after a reload', async ({ page }) => {
    const api = recordApi(page);
    await signIn(page);
    await go(page, '/dashboard?tab=profile');
    await page.fill('#pf-name', 'Real Buyer Renamed');
    await page.fill('#pf-org', 'Verify Motors');
    await page.getByRole('button', { name: /Save profile/ }).click();
    await expect.poll(() => api.last('PATCH', '/api/users/me')?.status).toBe(200);
    expect(user()).toMatchObject({ name: 'Real Buyer Renamed', organization: 'Verify Motors' });
    await page.reload();
    await expect(page.locator('#pf-name')).toHaveValue('Real Buyer Renamed');
    await expect(page.locator('#pf-org')).toHaveValue('Verify Motors');
  });

  test('sign out ends the session on the server; protected pages then need a sign-in', async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/dashboard/);
    const uid = user().id;
    const active = () => db('select count(*)::int n from auth_sessions where user_id = %s and revoked_at is null', uid)[0].n;
    const before = active();
    await page.locator('#nav-avatar').click();
    const out = await clickFor(page, page.locator('#nav-signout-btn'), 'POST', '/api/auth/logout');
    expect(out.status).toBe(200);
    await expect(page.getByText('You have been signed out.')).toBeVisible();
    expect(active()).toBe(before - 1);          // only THIS browser's session ends (other devices stay signed in)
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
    await go(page, '/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('sign in: wrong password refused with a message, right password works', async ({ page }) => {
    const bad = await signIn(page, 'Wrong-Password-000');
    expect(bad.status).toBe(401);
    await expect(page.locator('[role="alert"]').first()).toBeVisible();
    await page.fill('#login-pass', PASSWORD);
    await submit(page).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('forgotten password: reset code changes the password; the old one stops working', async ({ page }) => {
    const api = recordApi(page);
    const oldHash = user().password_hash;
    await go(page, '/forgot-password');
    await page.fill('#forgot-email', EMAIL);
    const before = outboxSize();
    await submit(page).click();
    await expect(page).toHaveURL(/\/reset-password/);
    expect(api.last('POST', '/api/auth/forgot-password').status).toBe(200);
    const code = lastCode(EMAIL, before);
    await page.fill('#reset-email', EMAIL);
    await page.fill('#reset-code', code);
    await page.fill('#reset-password', NEW_PASSWORD);
    await page.fill('#reset-confirm', NEW_PASSWORD);
    await submit(page).click();
    await expect(page).toHaveURL(/\/login/);
    expect(api.last('POST', '/api/auth/reset-password').status).toBe(200);
    expect(user().password_hash).not.toBe(oldHash);

    expect((await signIn(page, PASSWORD)).status).toBe(401);
    await page.fill('#login-pass', NEW_PASSWORD);
    await submit(page).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('a buyer cannot open the admin console, in the browser or through the API', async ({ page }) => {
    const api = recordApi(page);
    await signIn(page, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/admin');
    await expect(page).not.toHaveURL(/\/admin/);
    const res = await page.request.get('/api/admin/dashboard');
    expect(res.status()).toBe(403);
    test.info().annotations.push({ type: 'api', description: `GET /api/admin/dashboard as buyer -> ${res.status()}` });
    expect(api.calls.length).toBeGreaterThan(0);
  });

  test('signed out, the dashboard and admin pages send you to sign in, and the API answers 401', async ({ page }) => {
    await go(page, '/dashboard');
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
    expect((await page.request.get('/api/users/me')).status()).toBe(401);
    expect((await page.request.get('/api/admin/dashboard')).status()).toBe(401);
  });
});

export { EMAIL as REAL_BUYER_EMAIL };
