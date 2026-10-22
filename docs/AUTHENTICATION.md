# Salvex authentication: how it works, how to run it, how to deploy it safely

This document describes the sign-up / sign-in system as it is **actually implemented** in this repository
(`backend/` = FastAPI, `src/` = React website). It is the reference for developers and for whoever deploys it.

- [1. What a visitor can do](#1-what-a-visitor-can-do)
- [2. How sessions work](#2-how-sessions-work)
- [3. Endpoints](#3-endpoints)
- [4. Security controls](#4-security-controls)
- [5. Configuration](#5-configuration)
- [6. Running it locally](#6-running-it-locally)
- [7. Administrator accounts](#7-administrator-accounts)
- [8. Deploying to production](#8-deploying-to-production)
- [9. Tests and checks](#9-tests-and-checks)
- [10. Known limitations and residual risks](#10-known-limitations-and-residual-risks)

---

## 1. What a visitor can do

| Step | Website page | What happens |
|---|---|---|
| Create an account | `/register` | Name, email, password (+ confirmation), **bidder or seller**, optional mobile and organization. KYC is **not** part of sign-up. |
| Verify the email | `/verify-email` | A 6-digit code is emailed. It expires in 10 minutes, works once, allows 5 attempts, and can be re-sent after 60 seconds. |
| Sign in | `/login` | Verified email + password. Wrong-password and unknown-email look identical. |
| Stay signed in | (automatic) | On every page load the website asks `GET /api/auth/me`. Refreshing the page keeps you signed in. |
| Sign out | navbar | Ends the session **on the server** and clears this device. |
| Forgot password | `/forgot-password`, `/reset-password` | A separate-purpose 6-digit code (15 minutes). Resetting signs the account out **on every device** and emails a "password changed" notice. |

Role-based landing page after sign-in: admin → `/admin`, seller → `/seller/dashboard`, bidder → `/dashboard`
(or the page the person was trying to open). Protected pages wait for the session check before deciding, so
there is no redirect flash and no private content is shown to anonymous visitors.

**Important:** the dashboards, bidding, payments and the like still show **sample data**. Only authentication is real.

---

## 2. How sessions work

```
browser                                   API                                   database
  | POST /api/auth/login  (email, password) |                                        |
  |---------------------------------------->| check password (bcrypt)                |
  |                                         | INSERT auth_sessions (id, user, expiry)|
  |  Set-Cookie: access_token=<JWT>         |                                        |
  |       (HttpOnly, Secure*, SameSite=Lax) |   JWT carries: user id, session id,    |
  |  body: user + csrf_token                |   issuer, issued/expiry times          |
  |<----------------------------------------|                                        |
  | GET /api/auth/me   (cookie)             | verify JWT -> load session + user ->   |
  |---------------------------------------->| must be: not revoked, not expired,     |
  |                                         | not idle too long, user active+verified|
  | POST /api/auth/logout  (cookie +        |                                        |
  |        X-CSRF-Token header)             | UPDATE auth_sessions SET revoked_at    |
```

- The login token is a signed JWT, but **it is only the key to a row in `auth_sessions`**. Every request checks that row,
  so logging out, resetting a password, promoting/suspending an account or exceeding the session limit takes effect **immediately**.
- The **role is read from the database on every request**, never from the token or the browser.
- The cookie is `HttpOnly` (scripts cannot read it) and the website keeps **nothing** about the session in
  `localStorage`/`sessionStorage`. The signed-in user is held in memory and restored from `/api/auth/me`.
- Defaults: 12 hours absolute lifetime, 2 hours idle timeout, at most 10 active sessions per user (oldest are revoked).
- *Secure and the `__Host-` cookie-name prefix are on by default everywhere except development/test.*

### CSRF (cross-site request forgery) defence, two layers
1. **Origin check:** every `POST/PUT/PATCH/DELETE` that carries an `Origin` (or `Referer`) from a site that is not in
   `FRONTEND_ORIGINS` is rejected with `403 csrf_origin` before any code runs (this also blocks "login CSRF").
2. **Per-session CSRF token:** state-changing endpoints that are authenticated by the cookie (`logout`, `logout-all`) also
   require the header `X-CSRF-Token`. The token is returned by `login` and `/me`, kept in memory by the website, and cannot
   be read by another site. Clients using `Authorization: Bearer` (no ambient cookie) do not need it.

---

## 3. Endpoints

All under `/api/auth`. Errors are `{"detail": "<message>", "code": "<machine code>"}`; validation errors (422) list only the
field and message (the submitted values are never echoed back).

| Method and path | Needs sign-in | Purpose | Notable responses |
|---|---|---|---|
| `POST /register` | no | Create (or restart) an account | Always `201` with the same message for new and existing emails |
| `POST /verify-email` | no | Confirm the email with the 6-digit code | `400 invalid_code` / `code_locked` |
| `POST /resend-otp` | no | New verification (or reset) code | Always `200`, same message |
| `POST /login` | no | Start a session | `401 invalid_credentials`, `403 email_not_verified`, `403 account_suspended` |
| `GET /me` | cookie or bearer | Current user + CSRF token | `401 not_authenticated` |
| `POST /logout` | optional | End this session, clear cookie | `403 csrf_failed` if the cookie is used without the token |
| `POST /logout-all` | yes + CSRF | End every session of this user | |
| `POST /forgot-password` | no | Email a reset code | Always `200`, same message |
| `POST /reset-password` | no | Set a new password with the code | `400 invalid_code` / `code_locked` |

Any endpoint can also answer `429 rate_limited` (with a `Retry-After` header) and `403 csrf_origin`.
Non-browser clients can ask for the token in the login response body with the header `X-Auth-Mode: bearer`;
browsers never receive it in the body.

Request bodies reject **unknown fields** (so `role`, `is_active`, `kyc_status` etc. cannot be smuggled in) and the only roles that
can be chosen at registration are `bidder` and `seller`.

---

## 4. Security controls

| Area | Control |
|---|---|
| Passwords | bcrypt (cost 12, random salt) over a SHA-256 pre-hash, so passwords of any length (up to 128 characters) work and none is truncated. 8–128 characters, not a very common password (including "word + digits" variants), not the email address. No forced character classes. Plaintext is never stored or logged. |
| Login errors | Same message, status and time for "no such email" and "wrong password" (a dummy hash check is run). "Suspended"/"unverified" are revealed only **after** a correct password. |
| One-time codes | `secrets`-generated; stored as **HMAC-SHA256 keyed with the server secret and bound to purpose + user**, so a copy of the database cannot be used to brute-force them and a reset code can never verify an email (or vice versa). Single use, expiry, 5 attempts, 60-second resend cooldown, older codes invalidated on re-issue, row-locked checks so parallel requests cannot reuse a code or skip the attempt counter. |
| Account enumeration | `register`, `resend-otp`, `forgot-password` give the same answer for known and unknown emails; verification/reset failures have the same shape ("N attempt(s) remaining", then "Too many failed attempts") for real and non-existent accounts; emails are sent **after** the response (background task) so timing does not leak; an already-registered owner is told by email. |
| Pre-registration takeover | Re-registering an **unverified** email replaces the pending name/password and issues a new code, and the single live code always belongs to the newest submission. Only someone who can read the mailbox can ever verify. |
| Rate limiting | Per IP, per email (hashed) and per IP+email pair on `login`, `register`, `verify`, `resend`, `forgot`, `reset`, `session` endpoints (table below). Blocks expire by themselves; there is **no** long account lockout (it would let anyone lock a victim out), and blocking one account does not block others from the same IP. |
| Sessions | Server-side revocation (logout, logout-all, password reset, role change, deactivation), absolute + idle expiry, per-user session cap, expired sessions pruned. |
| Cookies | HttpOnly, Secure (default outside development), SameSite=Lax, path `/`, host-only (no Domain), `__Host-` name prefix when Secure. |
| CSRF / CORS | Origin check + per-session CSRF token (above). CORS allows only the configured origins and an explicit header list; no wildcard. |
| Authorization | Role from the database on every request; `require_role` dependency for business endpoints; schemas forbid unknown fields; no endpoint can set a role; **no admin-creation endpoint exists** (see §7). |
| Email | SMTP with certificate verification (STARTTLS or implicit TLS), HTML-escaped templates, notices for "account already exists" and "password changed". |
| Logging | Codes, passwords, tokens and full email addresses never appear in logs (addresses are masked, e.g. `a***@example.com`). 422 responses never echo submitted values. Settings errors never echo secret values. |
| Response headers | `Cache-Control: no-store` on auth responses, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a locked-down CSP for API responses, HSTS in production. |
| Safe defaults | An unset `APP_ENV` means **production**. Production-like environments refuse to start with a weak secret, non-HTTPS/localhost origins, insecure cookies, disabled rate limiting or the developer email outbox. API docs are hidden in production. |

Rate-limit policy (requests allowed per window; `ip+email` is the strictest):

| Scope | Limits |
|---|---|
| login | 8 / 15 min per IP+email; 40 / 15 min per IP; 30 / 15 min per email |
| register | 10 / hour per IP; 5 / hour per email |
| verify-email, reset-password | 10 / 15 min per IP+email; 60 / 15 min per IP; 30 / 15 min per email |
| resend-otp, forgot-password | 5 / hour per email; 20 / hour per IP |
| me, logout, logout-all | 600 / minute per IP |

---

## 5. Configuration

All settings are environment variables (see `backend/.env.example` for the full annotated list). The ones that matter most:

| Variable | Development | Production |
|---|---|---|
| `APP_ENV` | `development` | `production` (or `staging`, held to the same rules) |
| `APP_SECRET_KEY` | any 16+ characters | random, 32+ characters, secret |
| `DATABASE_URL` | local PostgreSQL | hosted PostgreSQL, with `?sslmode=require` (or `verify-full`) |
| `FRONTEND_ORIGINS` | `http://localhost:5173,...` | `https://your-site` only |
| `EMAIL_PROVIDER` | `console` (developer outbox) | `smtp` with `SMTP_HOST/PORT/USER/PASSWORD/FROM_EMAIL` |
| `COOKIE_SECURE` | unset (off) | unset or `true` |
| `RATE_LIMIT_ENABLED` | `true` | `true` (required) |
| `TRUSTED_PROXY_COUNT` | `0` | number of reverse proxies in front of the API |

Never commit `.env`. Rotating `APP_SECRET_KEY` signs everyone out and invalidates pending one-time codes (acceptable and safe).

---

## 6. Running it locally

```powershell
# 1. one-time: add the sessions table to YOUR LOCAL development database
cd backend
.\.venv\Scripts\Activate.ps1
alembic upgrade head            # applies 7b2f4a9c1d3e (adds auth_sessions; changes nothing else)

# 2. start the API
uvicorn app.main:app --host 127.0.0.1 --port 8000

# 3. in another window, start the website (it forwards /api to the API)
cd ..
npm run dev                      # http://localhost:5173
```

In development no real email is sent. The "email" is written to `backend/.dev_outbox/outbox.jsonl` (ignored by Git) and the
application log says only that a message was written. To read the latest code for an address:

```powershell
python -m app.cli dev-last-code you@example.com
```

Developer-only demo screens (sample admin/seller/bidder pages, **no real sign-in, no privileges**) can be switched on with
`VITE_ENABLE_DEMO_PERSONAS=true` for `npm run dev`. They are off by default and are compiled out of every production build,
even if that variable is set by mistake (`npm run check:no-demo` proves it).

---

## 7. Administrator accounts

There is deliberately **no way to become an administrator through the website or the API**. Public registration only accepts
`bidder` and `seller`, and requests cannot carry extra fields. Administrators are created by an operator with shell access
to the server and its database:

```powershell
cd backend
python -m app.cli create-admin --email boss@your-domain.example --name "Boss Name"
#   asks for the password twice at a hidden prompt (12+ characters, not a common password),
#   then asks you to retype the email to confirm. The password is never printed or logged.

python -m app.cli create-admin --email existing.user@your-domain.example --promote-existing
#   promotes an existing ACTIVE, EMAIL-VERIFIED user; their current sessions are revoked so they sign in again.
```

The command uses whatever database `DATABASE_URL` points at, so check that first. It never runs automatically, and no
administrator was created while this system was built. Recommended next hardening: two-factor authentication for admins (not built).

---

## 8. Deploying to production

1. **HTTPS everywhere**, and set the production variables in §5. The API refuses to start if they are unsafe.
2. **Keep the website and API on the same site** so the cookie is sent and cross-site protections work:
   - best: a reverse proxy (or Vercel rewrite to the API's address) so the browser only ever talks to **one origin**, with `/api/*` forwarded to the API;
   - or: `app.example.com` + `api.example.com` (same registrable domain), `FRONTEND_ORIGINS=https://app.example.com`, host-only cookie on the API host;
   - avoid unrelated domains (the cookie would be a third-party cookie, which modern browsers block).
   Today `vercel.json` rewrites `/api/*` to a local function that does not exist; point it at the real API address once the API is hosted.
3. **Set `TRUSTED_PROXY_COUNT`** to exactly the number of proxies in front of the API, otherwise every client looks like the proxy's IP (or, if too high, IPs can be faked).
4. **Rate limiter and multiple instances.** The built-in limiter keeps counters in each process's memory. With *N* worker processes/instances the effective limit is up to *N* times higher and a restart resets it. For more than one process, replace `app.core.rate_limit.limiter` with a shared store such as Redis (same three methods). Database-backed protections (code attempts, cooldowns, session revocation) are shared and unaffected.
5. **Database migration.** `7b2f4a9c1d3e` only **adds** the `auth_sessions` table. Before running `alembic upgrade head` on any hosted database: take a backup, run it first on a copy, and get the database owner's approval. Rollback: `alembic downgrade c96cd80717e8` drops the table (everyone is signed out; nothing else changes). Tokens issued before the migration have no session id and are rejected, so users simply sign in again once.
6. **Email.** Configure SMTP (and SPF/DKIM/DMARC for your sending domain, or messages land in spam). Nothing is delivered until this is done, so nobody can verify an account.
7. **Monitoring.** Alert on spikes of `429`, `401`, `403 csrf_*` and on email delivery failures (logged as `Queued email could not be delivered`).

---

## 9. Tests and checks

| What | Command (from the project root unless noted) |
|---|---|
| Backend (192 tests; isolated local `salvex_test_db`) | `cd backend` then `python -m pytest -p no:cacheprovider -q` |
| Website build | `npm run build` |
| Lint | `npm run lint` |
| Browser tests (login, register, verify, reset, sessions, protected pages, demo flag; desktop + mobile) | `npx playwright test` (uses a mocked backend, no database needed) |
| Production build has no demo code | `npm run check:no-demo` |
| Database matches the models | `cd backend` then `alembic check` |

The backend tests refuse to run against anything but a **local** database whose name contains "test" (see `backend/tests/safe_db.py`).
Create it once with the normal PostgreSQL tools, then apply migrations to it with `alembic upgrade head` while `DATABASE_URL` points at it.
Upgrade/downgrade round-trips are done by hand because they change the shared test database's schema.

---

## 10. Known limitations and residual risks

- **No two-factor authentication**, CAPTCHA or password-breach check (only a small built-in list of common passwords).
- **In-memory rate limiter** (see §8.4).
- **Email is the root of trust.** Anyone who controls a mailbox can recover its account. Sessions are not tied to an IP or device.
- **Registration race (low).** While a genuine person's registration is pending, someone who knows their email could register it again; the newer submission wins and a *new* code is emailed. A victim who then enters that unexpected code would end up with the attacker's password. The emails say to ignore codes you did not request, re-registration is rate limited, and the real owner can always recover with "Forgot password".
- **Small response differences remain possible** between known and unknown emails in extreme timing/ordering cases (for example immediately after a code is re-issued inside the 60-second window). Responses are otherwise identical.
- **Mobile numbers are stored, not verified**, and cannot be used to sign in (there is no SMS provider).
- **Rotating `APP_SECRET_KEY`** invalidates all sessions and codes.
- **No session-management screen** (the `logout-all` endpoint exists, but the website has no button for it yet).
- **The business pages still show sample data**, including a pre-filled sample email in the bidder dashboard's profile tab.
- KYC document submission, seller approval and per-endpoint authorization for future business APIs are **not part of this system yet**; each new endpoint must use `require_role` and `require_csrf`.
