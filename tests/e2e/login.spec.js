import { test, expect } from '@playwright/test';
import { mockApi, USERS, open } from './helpers/mockApi';

const PASSWORD = 'CorrectHorse!42';
const submit = (page) => page.locator('form.login-form button[type="submit"]');
const alertBox = (page) => page.locator('[role="alert"]').first();

async function signInForm(page, email, password) {
  await page.fill('#login-email', email);
  await page.fill('#login-pass', password);
  await submit(page).click();
}

test.describe('sign-in page', () => {
  let api;
  test.beforeEach(async ({ page }) => {
    api = await mockApi(page);
    api.addAccount({ user: USERS.bidder, password: PASSWORD });
    api.addAccount({ user: USERS.seller, password: PASSWORD });
    api.addAccount({ user: USERS.admin, password: PASSWORD });
  });

  test('starts empty, with no pre-filled demo credentials, fake mobile-code tab or persona buttons', async ({ page }) => {
    await open(page, '/login');
    await expect(page.locator('#login-email')).toHaveValue('');
    await expect(page.locator('#login-pass')).toHaveValue('');
    await expect(page.locator('#login-pass')).toHaveAttribute('autocomplete', 'current-password');
    await expect(page.locator('#login-email')).toHaveAttribute('autocomplete', 'username');
    const text = await page.locator('main').innerText();
    for (const forbidden of ['Mobile OTP', '482910', 'Demo Bidder', 'Super Admin', 'Persona', 'demo.bidder@example.com']) {
      expect(text).not.toContain(forbidden);
    }
  });

  test('a wrong password gives one clear message, clears the password and keeps you on the page', async ({ page }) => {
    await open(page, '/login');
    await signInForm(page, USERS.bidder.email, 'not-the-password');
    await expect(alertBox(page)).toContainText('Incorrect email address or password');
    await expect(page.locator('#login-pass')).toHaveValue('');
    await expect(page).toHaveURL(/\/login/);
  });

  test('an unverified account is offered the verification step, with its email carried over', async ({ page }) => {
    api.addAccount({ user: { ...USERS.bidder, email: 'new@example.com' }, password: PASSWORD, verified: false });
    await open(page, '/login');
    await signInForm(page, 'new@example.com', PASSWORD);
    await expect(page.locator('[role="status"], [role="alert"]').filter({ hasText: 'has not been verified' })).toBeVisible();
    await page.getByRole('button', { name: 'Enter verification code' }).click();
    await expect(page).toHaveURL(/\/verify-email$/);
    await expect(page.locator('#verify-email')).toHaveValue('new@example.com');
  });

  test('a suspended account sees the reason from the server', async ({ page }) => {
    api.override('POST /api/auth/login', () =>
      api.error(403, 'This account is suspended. Please contact Salvex support.', 'account_suspended'));
    await open(page, '/login');
    await signInForm(page, USERS.bidder.email, PASSWORD);
    await expect(alertBox(page)).toContainText('suspended');
  });

  test('rate limiting tells the person how long to wait', async ({ page }) => {
    api.override('POST /api/auth/login', () =>
      api.error(429, 'Too many requests. Please try again in 42 seconds.', 'rate_limited', { 'Retry-After': '42' }));
    await open(page, '/login');
    await signInForm(page, USERS.bidder.email, PASSWORD);
    await expect(alertBox(page)).toContainText('wait 42 seconds');
  });

  test('a network failure is reported as a connection problem', async ({ page }) => {
    api.override('POST /api/auth/login', () => 'abort');
    await open(page, '/login');
    await signInForm(page, USERS.bidder.email, PASSWORD);
    await expect(alertBox(page)).toContainText('Could not reach the server');
  });

  test('an unexpected server error shows a calm message and never server internals', async ({ page }) => {
    api.override('POST /api/auth/login', () => api.json(500, { detail: 'Traceback (most recent call last): secret internals' }));
    await open(page, '/login');
    await signInForm(page, USERS.bidder.email, PASSWORD);
    await expect(alertBox(page)).toContainText('Something went wrong on our side');
    await expect(page.locator('body')).not.toContainText('Traceback');
  });

  for (const [key, destination] of [['bidder', /\/dashboard$/], ['seller', /\/seller\/dashboard$/], ['admin', /\/admin$/]]) {
    test(`a ${key} lands on the page for their real role`, async ({ page }) => {
      await open(page, '/login');
      await signInForm(page, USERS[key].email, PASSWORD);
      await expect(page).toHaveURL(destination);
    });
  }

  test('sign-in sends only the email and password, stores nothing in the browser, and puts nothing sensitive in the URL', async ({ page }) => {
    await open(page, '/login');
    await signInForm(page, USERS.bidder.email, PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);

    const [call] = api.callsTo('POST', '/api/auth/login');
    expect(Object.keys(call.body).sort()).toEqual(['identifier', 'password']);
    expect(page.url()).not.toContain(PASSWORD);
    expect(page.url()).not.toContain('@');
    const stored = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), cookie: document.cookie }));
    expect(stored).toEqual({ local: [], session: [], cookie: '' });
  });

  test('after signing in you are taken back to the page you were trying to open', async ({ page }) => {
    await page.goto('/orders/order-1/receipt');
    await expect(page).toHaveURL(/\/login$/);
    await page.locator('.salvex-page-loader').waitFor({ state: 'detached', timeout: 20000 });
    await signInForm(page, USERS.bidder.email, PASSWORD);
    await expect(page).toHaveURL(/\/orders\/order-1\/receipt$/);
  });

  test('someone who is already signed in is sent to their own home instead of seeing the form', async ({ page }) => {
    api.signIn(USERS.seller);
    await page.goto('/login');
    await expect(page).toHaveURL(/\/seller\/dashboard$/);
  });

  test('the form cannot be submitted twice while a request is in progress', async ({ page }) => {
    api.override('POST /api/auth/login', async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      api.signIn(USERS.bidder);
      return api.json(200, { message: 'Login successful', access_token: null, token_type: 'bearer', user: USERS.bidder, csrf_token: 'x' });
    });
    await open(page, '/login');
    await page.fill('#login-email', USERS.bidder.email);
    await page.fill('#login-pass', PASSWORD);
    await submit(page).click();
    await expect(submit(page)).toBeDisabled();
    await page.locator('#login-pass').press('Enter');
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(api.callsTo('POST', '/api/auth/login')).toHaveLength(1);
  });

  test('the password can be shown and hidden', async ({ page }) => {
    await open(page, '/login');
    await page.fill('#login-pass', 'abc');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(page.locator('#login-pass')).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(page.locator('#login-pass')).toHaveAttribute('type', 'password');
  });

  test('links to registration and password recovery work', async ({ page }) => {
    await open(page, '/login');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await page.goBack();
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page).toHaveURL(/\/register$/);
  });
});
