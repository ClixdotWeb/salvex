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
        if (!account) return error(400, 'Invalid or expired verification code.', 'invalid_code');
        account.verified = true;
        state.user = account.user;            // like the real backend: a correct code signs the user in
        return json(200, {
          message: 'Email verified. You are now signed in.', success: true,
          user: account.user, csrf_token: CSRF, access_token: null, token_type: 'bearer',
        });
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

  // Read-only data endpoints used by the real pages. By default they answer with empty lists, like a
  // fresh database; a test can put rows in `state.data` (path -> items) or use override().
  const emptyPage = (items = []) => json(200, { items, page: 1, page_size: 20, total: items.length, pages: items.length ? 1 : 0 });
  const LIST_PATHS = [
    '/api/catalogue/vehicles', '/api/auctions', '/api/parts', '/api/notifications', '/api/bids/mine',
    '/api/part-requests/mine', '/api/vehicles/mine', '/api/admin/users', '/api/admin/kyc/submissions', '/api/admin/vehicles',
    '/api/admin/auctions', '/api/admin/orders', '/api/admin/parts', '/api/admin/part-requests', '/api/admin/contact-messages',
    '/api/admin/audit-logs', '/api/admin/results', '/api/ready-to-lift', '/api/admin/enquiries',
  ];
  state.data = new Map();
  for (const path of LIST_PATHS) handlers[`GET ${path}`] = () => emptyPage(state.data.get(path) || []);
  handlers['GET /api/notifications/unread-count'] = () => (state.user ? json(200, { unread: 0 }) : error(401, 'Authentication required.', 'not_authenticated'));
  handlers['GET /api/catalogue/vehicle-options'] = () => json(200, {});
  handlers['GET /api/site-config'] = () => json(200, { online_payment: state.onlinePayment ?? false, seller_accounts: state.sellerAccounts ?? true });
  handlers['GET /api/orders/mine'] = () => json(200, []);
  handlers['GET /api/ready-to-lift/interests/mine'] = () => json(200, []);
  handlers['GET /api/kyc/me'] = () => json(200, { kyc_status: state.user?.kyc_status || 'pending', submission: null });
  handlers['GET /api/admin/dashboard'] = () => json(200, {
    users_total: 3, bidders: 1, sellers: 1, suspended_users: 0, kyc_waiting_review: 0, vehicles_waiting_review: 0,
    vehicles_approved: 0, auctions_live: 0, auctions_upcoming: 0, auctions_paused: 0, auctions_awaiting_close: 0,
    bids_today: 0, orders_awaiting_payment: 0, payments_to_confirm: 0, part_requests_new: 0, contact_messages_new: 0,
    server_time: new Date().toISOString(),
  });

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
      const call = { method: request.method(), path, query: new URL(request.url()).search, body, headers: request.headers() };
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
