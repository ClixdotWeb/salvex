import { test, expect } from '@playwright/test';
import { mockApi, open } from './helpers/mockApi';

const submit = (page) => page.locator('form.login-form button[type="submit"]');

async function fillValid(page, overrides = {}) {
  const v = { name: 'Priya Sharma', email: 'priya@example.com', password: 'Maple-Tree-Walks-12', mobile: '+91 98765 43210', ...overrides };
  await page.fill('#reg-name', v.name);
  await page.fill('#reg-email', v.email);
  await page.fill('#reg-password', v.password);
  await page.fill('#reg-mobile', v.mobile);
}

test.describe('registration page', () => {
  let api;
  test.beforeEach(async ({ page }) => {
    api = await mockApi(page);
    await open(page, '/register');
  });

  test('a short form (no confirm password, no organization) offering bidder and seller (never admin)', async ({ page }) => {
    await expect(page.locator('#reg-confirm')).toHaveCount(0);
    await expect(page.locator('#reg-organization')).toHaveCount(0);
    await expect(page.getByRole('radio')).toHaveCount(2);
    await expect(page.getByRole('radio', { name: /Bidder/ })).toBeChecked();
    await expect(page.getByRole('radio', { name: /Seller/ })).not.toBeChecked();
    await expect(page.locator('#main-content').getByText(/admin/i)).toHaveCount(0);
  });

  test('checks everything in the browser first, field by field, before calling the server', async ({ page }) => {
    await fillValid(page, { name: 'A', email: 'not-an-email', password: 'short', mobile: 'abc' });
    await submit(page).click();
    await expect(page.getByText('Enter your full name')).toBeVisible();
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    await expect(page.getByText('Use at least 8 characters.')).toBeVisible();
    await expect(page.getByText('Enter a valid mobile number')).toBeVisible();
    expect(api.callsTo('POST', '/api/auth/register')).toHaveLength(0);
    await expect(page.locator('#reg-email')).toHaveAttribute('aria-invalid', 'true');
  });

  test('a password equal to the email is refused', async ({ page }) => {
    await fillValid(page, { password: 'priya@example.com' });
    await submit(page).click();
    await expect(page.getByText('must not be your email address')).toBeVisible();
  });

  test('sends exactly the fields the backend accepts, then moves to verification without putting data in the URL', async ({ page }) => {
    await fillValid(page, { mobile: '+91 98765 43210' });
    await submit(page).click();
    await expect(page).toHaveURL(/\/verify-email$/);

    const [call] = api.callsTo('POST', '/api/auth/register');
    expect(call.body).toEqual({
      name: 'Priya Sharma', email: 'priya@example.com', password: 'Maple-Tree-Walks-12',
      role: 'bidder', mobile: '+91 98765 43210', organization: '',
    });
    expect(page.url()).not.toContain('priya');
    expect(page.url()).not.toContain('Maple');
    await expect(page.locator('#verify-email')).toHaveValue('priya@example.com');
  });

  test('the mobile number is required', async ({ page }) => {
    await fillValid(page, { mobile: '' });
    await submit(page).click();
    await expect(page.getByText('Enter your mobile number.')).toBeVisible();
    expect(api.callsTo('POST', '/api/auth/register')).toHaveLength(0);
  });

  test('the seller choice is sent', async ({ page }) => {
    await fillValid(page);
    await page.getByRole('radio', { name: /Seller/ }).check();
    await submit(page).click();
    await expect(page).toHaveURL(/\/verify-email$/);
    const [call] = api.callsTo('POST', '/api/auth/register');
    expect(call.body.role).toBe('seller');
    expect(call.body.mobile).toBe('+91 98765 43210');
    expect(call.body.organization).toBe('');
  });

  test('problems found by the server appear next to the right field', async ({ page }) => {
    api.override('POST /api/auth/register', () =>
      api.json(422, {
        detail: [{ loc: ['body', 'password'], msg: 'This password is too common. Please choose a different one.' }],
        code: 'validation_error',
      }));
    await fillValid(page, { password: 'Password-ish-1' });
    await submit(page).click();
    await expect(page.locator('#reg-password-error')).toContainText('too common');
    await expect(page).toHaveURL(/\/register$/);
  });

  test('rate limits and connection problems are explained', async ({ page }) => {
    api.override('POST /api/auth/register', () =>
      api.error(429, 'Too many requests.', 'rate_limited', { 'Retry-After': '30' }));
    await fillValid(page);
    await submit(page).click();
    await expect(page.locator('[role="alert"]').first()).toContainText('wait 30 seconds');

    api.override('POST /api/auth/register', () => 'abort');
    await submit(page).click();
    await expect(page.locator('[role="alert"]').first()).toContainText('Could not reach the server');
  });

  test('the password can be revealed and the form is labelled for screen readers', async ({ page }) => {
    await page.fill('#reg-password', 'abc');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(page.locator('#reg-password')).toHaveAttribute('type', 'text');
    for (const label of ['Full name', 'Email address', 'Password', 'Mobile number']) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(page.locator('#reg-password')).toHaveAttribute('autocomplete', 'new-password');
  });
});

test('with seller accounts switched off, everyone registers as a bidder', async ({ page }) => {
  const api = await mockApi(page);
  api.state.sellerAccounts = false;
  await open(page, '/register');
  await expect(page.getByRole('radio', { name: /Seller/ })).toHaveCount(0);
  await expect(page.getByText('Register to bid on vehicles.', { exact: false })).toBeVisible();
  await fillValid(page);
  await submit(page).click();
  await expect(page).toHaveURL(/\/verify-email$/);
  const [call] = api.callsTo('POST', '/api/auth/register');
  expect(call.body.role).toBe('bidder');
});

test('/sell is not a public page when seller accounts are off (only admins add vehicles)', async ({ page }) => {
  const api = await mockApi(page);
  api.state.sellerAccounts = false;
  await open(page, '/sell');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#nav-list-vehicle-btn')).toHaveCount(0);
});
