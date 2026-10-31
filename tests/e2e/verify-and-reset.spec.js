import { test, expect } from '@playwright/test';
import { mockApi, USERS, open } from './helpers/mockApi';

const submit = (page) => page.locator('form.login-form button[type="submit"]');

test.describe('email verification', () => {
  let api;
  test.beforeEach(async ({ page }) => {
    api = await mockApi(page);
    api.addAccount({ user: USERS.bidder, password: 'CorrectHorse!42', verified: false });
    api.setCode('email_verification', USERS.bidder.email, '123456');
  });

  async function arriveFromRegistration(page) {
    await open(page, '/register');
    await page.fill('#reg-name', 'Asha Bidder');
    await page.fill('#reg-email', USERS.bidder.email);
    await page.fill('#reg-password', 'CorrectHorse!42');
    await page.fill('#reg-mobile', '+91 98765 43210');
    await submit(page).click();
    await expect(page).toHaveURL(/\/verify-email$/);
  }

  test('only digits are accepted and the button waits for all six', async ({ page }) => {
    await arriveFromRegistration(page);
    await page.fill('#verify-code', '12ab-34');   // also what a paste like "123-456" would look like
    await expect(page.locator('#verify-code')).toHaveValue('1234');
    await expect(submit(page)).toBeDisabled();
    await page.fill('#verify-code', '123456789');
    await expect(page.locator('#verify-code')).toHaveValue('123456');
    await expect(submit(page)).toBeEnabled();
    await expect(page.locator('#verify-code')).toHaveAttribute('autocomplete', 'one-time-code');
  });

  test('a wrong code shows the attempts left and clears the box; the right code signs the user in', async ({ page }) => {
    await arriveFromRegistration(page);
    await page.fill('#verify-code', '000000');
    await submit(page).click();
    await expect(page.locator('[role="alert"]').first()).toContainText('4 attempt(s) remaining');
    await expect(page.locator('#verify-code')).toHaveValue('');

    await page.fill('#verify-code', '123456');
    await submit(page).click();
    await expect(page).toHaveURL(/\/dashboard$/);                 // straight in, no second sign-in
    await page.reload();                                          // the session survives a reload (cookie)
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('the code and the email never appear in the address bar', async ({ page }) => {
    await arriveFromRegistration(page);
    await page.fill('#verify-code', '123456');
    expect(page.url()).not.toContain('123456');
    expect(page.url()).not.toContain('@');
    await submit(page).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(page.url()).not.toContain('@');
    const [call] = api.callsTo('POST', '/api/auth/verify-email');
    expect(call.body).toEqual({ email: USERS.bidder.email, otp: '123456' });
  });

  test('after too many wrong attempts the person is pointed to a new code', async ({ page }) => {
    api.override('POST /api/auth/verify-email', () =>
      api.error(400, 'Too many failed attempts. Please request a new code.', 'code_locked'));
    await arriveFromRegistration(page);
    await page.fill('#verify-code', '000000');
    await submit(page).click();
    await expect(page.locator('[role="alert"]').first()).toContainText('Too many failed attempts');
    await expect(page.locator('[role="alert"]').first()).toContainText('Send a new code');
  });

  test('resending is on a visible 60 second cooldown, then sends a new code', async ({ page }) => {
    test.setTimeout(120_000); // runs a simulated minute of countdown timers
    await page.clock.install();
    await arriveFromRegistration(page);
    const resend = page.getByRole('button', { name: /Send a new code/ });
    await expect(resend).toBeDisabled();
    await expect(resend).toContainText('in 6');          // counting down from 60

    await page.clock.runFor(61_000);
    await expect(resend).toBeEnabled();
    await resend.click();
    await expect(page.getByText('If this email is registered, a new code has been sent.')).toBeVisible();
    await expect(resend).toBeDisabled();
    expect(api.callsTo('POST', '/api/auth/resend-otp')[0].body).toEqual({ email: USERS.bidder.email, purpose: 'email_verification' });
  });

  test('being rate limited while resending is explained', async ({ page }) => {
    test.setTimeout(120_000); // runs a simulated minute of countdown timers
    await page.clock.install();
    api.override('POST /api/auth/resend-otp', () => api.error(429, 'Too many requests.', 'rate_limited', { 'Retry-After': '90' }));
    await arriveFromRegistration(page);
    await page.clock.runFor(61_000);
    await page.getByRole('button', { name: /Send a new code/ }).click();
    await expect(page.locator('[role="alert"]').first()).toContainText('wait 90 seconds');
  });
});

test.describe('forgotten password and reset', () => {
  let api;
  test.beforeEach(async ({ page }) => {
    api = await mockApi(page);
    api.setCode('password_reset', USERS.bidder.email, '654321');
  });

  async function requestReset(page) {
    await open(page, '/forgot-password');
    await page.fill('#forgot-email', USERS.bidder.email);
    await submit(page).click();
    await expect(page).toHaveURL(/\/reset-password$/);
  }

  test('asking for a reset continues to the code page with the same neutral message for any address', async ({ page }) => {
    await requestReset(page);
    await expect(page.getByText('If this email is registered, password reset instructions have been sent.')).toBeVisible();
    await expect(page.locator('#reset-email')).toHaveValue(USERS.bidder.email);
    expect(page.url()).not.toContain('@');
  });

  test('the login page link carries the typed email to the forgot-password page', async ({ page }) => {
    await open(page, '/login');
    await page.fill('#login-email', USERS.bidder.email);
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page.locator('#forgot-email')).toHaveValue(USERS.bidder.email);
  });

  test('checks the new password in the browser before calling the server', async ({ page }) => {
    await requestReset(page);
    await page.fill('#reset-code', '654321');
    await page.fill('#reset-password', 'short');
    await page.fill('#reset-confirm', 'different');
    await submit(page).click();
    await expect(page.getByText('Use at least 8 characters.')).toBeVisible();
    await expect(page.getByText('The two passwords do not match.')).toBeVisible();
    expect(api.callsTo('POST', '/api/auth/reset-password')).toHaveLength(0);
  });

  test('a wrong code is explained; a weak password from the server appears under the password field', async ({ page }) => {
    await requestReset(page);
    await page.fill('#reset-code', '000000');
    await page.fill('#reset-password', 'Maple-Tree-Walks-12');
    await page.fill('#reset-confirm', 'Maple-Tree-Walks-12');
    await submit(page).click();
    await expect(page.locator('[role="alert"]').first()).toContainText('attempt(s) remaining');

    api.override('POST /api/auth/reset-password', () =>
      api.json(422, { detail: [{ loc: ['body', 'new_password'], msg: 'This password is too common.' }], code: 'validation_error' }));
    await page.fill('#reset-code', '654321');
    await submit(page).click();
    await expect(page.locator('#reset-password-error')).toContainText('too common');
  });

  test('a successful reset sends the person to sign in with a clear confirmation', async ({ page }) => {
    await requestReset(page);
    await page.fill('#reset-code', '654321');
    await page.fill('#reset-password', 'Maple-Tree-Walks-12');
    await page.fill('#reset-confirm', 'Maple-Tree-Walks-12');
    await submit(page).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText(/password has been changed and you were signed out everywhere/)).toBeVisible();
    const [call] = api.callsTo('POST', '/api/auth/reset-password');
    expect(call.body).toEqual({ email: USERS.bidder.email, otp: '654321', new_password: 'Maple-Tree-Walks-12' });
    expect(page.url()).not.toContain('654321');
  });

  test('a locked code points to requesting a new one', async ({ page }) => {
    await requestReset(page);
    api.override('POST /api/auth/reset-password', () =>
      api.error(400, 'Too many failed attempts. Please request a new code.', 'code_locked'));
    await page.fill('#reset-code', '000000');
    await page.fill('#reset-password', 'Maple-Tree-Walks-12');
    await page.fill('#reset-confirm', 'Maple-Tree-Walks-12');
    await submit(page).click();
    await expect(page.locator('[role="alert"]').first()).toContainText('Send a new code');
  });
});
