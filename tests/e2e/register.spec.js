import { test, expect } from '@playwright/test';
import { mockApi, open } from './helpers/mockApi';

const submit = (page) => page.locator('form.login-form button[type="submit"]');

async function fillValid(page, overrides = {}) {
  const v = { name: 'Priya Sharma', email: 'priya@example.com', password: 'Maple-Tree-Walks-12', confirm: 'Maple-Tree-Walks-12', ...overrides };
  await page.fill('#reg-name', v.name);
  await page.fill('#reg-email', v.email);
  await page.fill('#reg-password', v.password);
  await page.fill('#reg-confirm', v.confirm);
  if (v.mobile !== undefined) await page.fill('#reg-mobile', v.mobile);
  if (v.organization !== undefined) await page.fill('#reg-organization', v.organization);
}

test.describe('registration page', () => {
  let api;
  test.beforeEach(async ({ page }) => {
    api = await mockApi(page);
    await open(page, '/register');
  });

  test('explains that KYC is separate and offers bidder and seller (never admin)', async ({ page }) => {
    await expect(page.getByText('does not complete KYC')).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(2);
    await expect(page.getByRole('radio', { name: /Bidder/ })).toBeChecked();
    await expect(page.getByRole('radio', { name: /Seller/ })).not.toBeChecked();
    await expect(page.locator('#main-content').getByText(/admin/i)).toHaveCount(0);
  });

  test('checks everything in the browser first, field by field, before calling the server', async ({ page }) => {
    await fillValid(page, { name: 'A', email: 'not-an-email', password: 'short', confirm: 'different', mobile: 'abc' });
    await submit(page).click();
    await expect(page.getByText('Enter your full name')).toBeVisible();
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    await expect(page.getByText('Use at least 8 characters.')).toBeVisible();
    await expect(page.getByText('The two passwords do not match.')).toBeVisible();
    await expect(page.getByText('Enter a valid mobile number')).toBeVisible();
    expect(api.callsTo('POST', '/api/auth/register')).toHaveLength(0);
    await expect(page.locator('#reg-email')).toHaveAttribute('aria-invalid', 'true');
  });

  test('a password equal to the email is refused', async ({ page }) => {
    await fillValid(page, { password: 'priya@example.com', confirm: 'priya@example.com' });
    await submit(page).click();
    await expect(page.getByText('must not be your email address')).toBeVisible();
  });

  test('sends exactly the fields the backend accepts, then moves to verification without putting data in the URL', async ({ page }) => {
    await fillValid(page, { mobile: '+91 98765 43210', organization: 'Priya Traders' });
    await submit(page).click();
    await expect(page).toHaveURL(/\/verify-email$/);

    const [call] = api.callsTo('POST', '/api/auth/register');
    expect(call.body).toEqual({
      name: 'Priya Sharma', email: 'priya@example.com', password: 'Maple-Tree-Walks-12',
      role: 'bidder', mobile: '+91 98765 43210', organization: 'Priya Traders',
    });
    expect(page.url()).not.toContain('priya');
    expect(page.url()).not.toContain('Maple');
    await expect(page.locator('#verify-email')).toHaveValue('priya@example.com');
  });

  test('the seller choice is sent, and optional fields can be left blank', async ({ page }) => {
    await fillValid(page);
    await page.getByRole('radio', { name: /Seller/ }).check();
    await submit(page).click();
    await expect(page).toHaveURL(/\/verify-email$/);
    const [call] = api.callsTo('POST', '/api/auth/register');
    expect(call.body.role).toBe('seller');
    expect(call.body.mobile).toBe('');
    expect(call.body.organization).toBe('');
  });

  test('problems found by the server appear next to the right field', async ({ page }) => {
    api.override('POST /api/auth/register', () =>
      api.json(422, {
        detail: [{ loc: ['body', 'password'], msg: 'This password is too common. Please choose a different one.' }],
        code: 'validation_error',
      }));
    await fillValid(page, { password: 'Password-ish-1', confirm: 'Password-ish-1' });
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

  test('passwords can be revealed together and the form is labelled for screen readers', async ({ page }) => {
    await page.fill('#reg-password', 'abc');
    await page.getByRole('button', { name: 'Show passwords' }).click();
    await expect(page.locator('#reg-password')).toHaveAttribute('type', 'text');
    await expect(page.locator('#reg-confirm')).toHaveAttribute('type', 'text');
    for (const label of ['Full name or company name', 'Email address', 'Password', 'Confirm password']) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(page.locator('#reg-password')).toHaveAttribute('autocomplete', 'new-password');
  });
});
