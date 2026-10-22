// A small in-memory stand-in for the backend authentication API, used by the browser tests.
// It answers exactly like the real endpoints (same paths, status codes and error codes; see
// backend/app/api/auth.py) and checks the same things the real backend checks (for example the CSRF
// header on logout), so the tests exercise the real website code without needing a database.
// Only requests whose path starts with /api/ are intercepted (not Vite's /src/api/*.js modules).

import { expect } from '@playwright/test';

export const USERS = {
  bidder: {
    id: '11111111-1111-4111-8111-111111111111', name: 'Asha Bidder', email: 'asha@example.com', role: 'bidder',
    mobile: '', organization: '', kyc_status: 'pending', is_email_verified: true, is_active: true,
  },
  seller: {
    id: '22222222-2222-4222-8222-222222222222', name: 'Sunil Seller', email: 'sunil@example.com', role: 'seller',
    mobile: '', organization: 'Sunil Motors', kyc_status: 'pending', is_email_verified: true, is_active: true,
  },
  admin: {
    id: '33333333-3333-4333-8333-333333333333', name: 'Alex Admin', email: 'alex@example.com', role: 'admin',
    mobile: '', organization: '', kyc_status: 'verified', is_email_verified: true, is_active: true,
  },
};

export const CSRF = 'csrf-token-for-tests';

const json = (status, body, headers = {}) => ({ status, body, headers });
const error = (status, detail, code, headers) => json(status, { detail, code }, headers);

export async function mockApi(page) {
  const state = {
    user: null,                 // who the fake server considers signed in
    accounts: new Map(),        // email -> { password, user, verified }
    codes: new Map(),           // `${purpose}:${email}` -> code
    attemptsLeft: 5,
    meDelayMs: 0,
    calls: [],                  // [{ method, path, body, headers }]
    overrides: new Map(),       // 'POST /api/auth/login' -> async ({ body }) => response | 'abort'
  };

  const handlers = {
    'GET /api/auth/me': () =>
      state.user
        ? json(200, { ...state.user, csrf_token: CSRF })
        : error(401, 'Authentication required. Please sign in to access this resource.', 'not_authenticated'),

    'POST /api/auth/login': ({ body }) => {
      const account = state.accounts.get(String(body.identifier || '').toLowerCase());
      if (!account || account.password !== body.password) return error(401, 'Invalid email or password.', 'invalid_credentials');
      if (!account.verified) return error(403, 'Please verify your email address before logging in.', 'email_not_verified');
      state.user = account.user;
      return json(200, { message: 'Login successful', access_token: null, token_type: 'bearer', user: account.user, csrf_token: CSRF });
    },

    'POST /api/auth/logout': ({ headers }) => {
      if (state.user && headers['x-csrf-token'] !== CSRF) return error(403, 'Security check failed.', 'csrf_failed');
      state.user = null;
      return json(200, { message: 'Successfully logged out.', success: true });
    },

    'POST /api/auth/register': () =>
      json(201, { message: 'Thanks! If this email address can be registered, a 6-digit verification code has been sent to it.', success: true }),

    'POST /api/auth/verify-email': ({ body }) => {
      if (state.codes.get(`email_verification:${body.email}`) === body.otp) {
        const account = state.accounts.get(String(body.email).toLowerCase());
        if (account) account.verified = true;
        return json(200, { message: 'Email verified successfully.', success: true });
      }
      state.attemptsLeft -= 1;
      if (state.attemptsLeft < 0) return error(400, 'Too many failed attempts. Please request a new code.', 'code_locked');
      return error(400, `Invalid or expired verification code. ${state.attemptsLeft} attempt(s) remaining.`, 'invalid_code');
    },

    'POST /api/auth/resend-otp': () => json(200, { message: 'If this email is registered, a new code has been sent.', success: true }),
    'POST /api/auth/forgot-password': () => json(200, { message: 'If this email is registered, password reset instructions have been sent.', success: true }),

    'POST /api/auth/reset-password': ({ body }) => {
      if (state.codes.get(`password_reset:${body.email}`) !== body.otp) {
        state.attemptsLeft -= 1;
        if (state.attemptsLeft < 0) return error(400, 'Too many failed attempts. Please request a new code.', 'code_locked');
        return error(400, `Invalid or expired reset code. ${state.attemptsLeft} attempt(s) remaining.`, 'invalid_code');
      }
      return json(200, { message: 'Password updated successfully.', success: true });
    },
  };

  await page.route(
    (url) => new URL(url).pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const key = `${request.method()} ${path}`;
      let body = null;
      try {
        body = request.postDataJSON();
      } catch {
        body = null;
      }
      const call = { method: request.method(), path, body, headers: request.headers() };
      state.calls.push(call);

      if (key === 'GET /api/auth/me' && state.meDelayMs) await new Promise((r) => setTimeout(r, state.meDelayMs));

      let result;
      if (state.overrides.has(key)) result = await state.overrides.get(key)(call);
      if (result === 'abort') return route.abort('failed');
      if (!result) result = handlers[key] ? handlers[key](call) : error(404, 'Not Found', 'http_404');

      return route.fulfill({
        status: result.status,
        contentType: 'application/json',
        headers: result.headers,
        body: JSON.stringify(result.body),
      });
    },
  );

  return {
    state,
    calls: state.calls,
    callsTo: (method, path) => state.calls.filter((c) => c.method === method && c.path === path),
    signIn: (user) => { state.user = user; },
    expireSession: () => { state.user = null; },
    addAccount: ({ user, password, verified = true }) => state.accounts.set(user.email.toLowerCase(), { user, password, verified }),
    setCode: (purpose, email, code) => state.codes.set(`${purpose}:${email}`, code),
    override: (key, fn) => state.overrides.set(key, fn),
    slowMe: (ms) => { state.meDelayMs = ms; },
    json,
    error,
  };
}

/** True for the one "failure" that is normal: asking who is signed in while nobody is. */
export function isExpectedAnonymousProbe(response) {
  return response.status() === 401 && new URL(response.url()).pathname === '/api/auth/me';
}

/** Wait until the page is usable: the app has rendered and the start-up loader (which blocks clicks) is gone. */
export async function waitForApp(page) {
  await expect(page.locator('#main-content')).toBeVisible();
  await expect(page.locator('.salvex-page-loader')).toHaveCount(0, { timeout: 20000 });
}

export async function open(page, path) {
  await page.goto(path);
  await waitForApp(page);
}
