# Salvex Auction: Production Readiness Audit

- **Date:** 23 November 2026
- **Code audited:** branch `feature/full-frontend`, commit `cf7c0a1`
- **Audit type:** read-only. No code was changed during this audit.
- **Secrets:** no secret values appear in this report.
- **Where things ran:** everything ran on the developer laptop (Windows), against the local PostgreSQL. No production system exists to test against (see C-01).

---

## A. Executive summary

**Verdict: NOT READY for production delivery tomorrow.**

The application code itself is in good shape:
- The backend has 543 automated tests, and all of them pass against a real PostgreSQL database.
- Security basics are done properly:
  - server-side sessions in HttpOnly cookies
  - two layers of CSRF protection
  - bcrypt password hashing
  - role checks on the server
  - KYC uploads checked by their file contents
  - a startup check that refuses unsafe production settings
- There is no fake data: no invented statistics, testimonials or phone numbers.

What blocks delivery is everything around the code:
- **Nothing is deployed.** `salvexauction.com` shows a Hostinger "Parked Domain" page.
- **Email (SMTP) is not configured.** Sign-up codes cannot reach anyone. The backend deliberately refuses to start in production without SMTP.
- **SMS is not built.** Mobile OTP is switched on by default, so production also refuses to start until SMS exists or the setting is turned off.
- **Company bank details are empty.** An auction winner would see no account to pay into.
- **The latest code exists only on one laptop.** Two commits have never been pushed to GitHub.
- **There are no database backups** and no monitoring.
- **The legal pages are drafts** and contradict themselves. Some service-page claims cannot be backed up.

Realistically, the site can go live in **1–2 working days**, and only if the client provides the following quickly:
- the SMTP login
- bank details
- contact details
- approved legal text
- Coolify access
- DNS access

Code changes needed for launch are small (see L. Remediation plan).

---

## B. Actual technology stack (verified from source)

| Layer | Technology | Evidence |
|---|---|---|
| Frontend | React 19.2, Vite 8, react-router-dom **7.1.5** (pinned), GSAP 3, lucide-react | `package.json` |
| Backend | Python 3.12, FastAPI 0.115.14, Starlette 0.46.2, Uvicorn 0.32.1, SQLAlchemy 2.0 (async), asyncpg, Alembic 1.14, Pydantic 2, bcrypt 5, PyJWT | `backend/requirements.txt`, installed packages |
| Database | PostgreSQL. 21 Alembic migrations, a single head (`e8a3c5f1b7d9`) | `alembic heads` / `alembic current` / `alembic check` |
| Admin panel | Part of the React app (`src/admin/`, route `/admin`) and served by the same API (`/api/admin/*`) | `src/App.jsx`, `backend/app/api/admin*.py` |
| Background jobs | Auction closer, payment reminders and overdue defaults run inside the API process | `backend/app/services/auction_closer.py`, `orders.py` |
| Email | SMTP (`SmtpEmailService`), or a developer "outbox" file | `backend/app/services/email.py` |
| SMS | **Developer outbox only. No real provider exists.** | `backend/app/services/sms.py`, `config.py:9` |
| Payments | No payment gateway. The buyer pays by bank transfer and submits the UTR; an admin confirms it. | `backend/app/services/orders.py` |
| Deployment (planned) | Coolify. Root `Dockerfile` (nginx + built React) and `backend/Dockerfile` (uvicorn) | `Dockerfile`, `backend/Dockerfile`, `deploy/nginx.conf.template` |
| CI | GitHub Actions: lint, build, demo-leak check, backend tests on a throwaway PostgreSQL | `.github/workflows/ci.yml` |
| Tests | pytest (backend, real DB). Playwright (frontend, **mocked API**). | `backend/tests/`, `tests/e2e/` |

**Routes:**
- 33 frontend routes, defined in `src/App.jsx`.
- About 110 API endpoints across 16 routers, listed in `backend/app/main.py:81-97`.

**Abandoned or duplicate code (not used by the running app):**
- `server/`: an old Express + Socket.io + MongoDB-style server. Nothing references it.
- `vercel.json`: Vercel config whose backend address is still a placeholder (`REPLACE-WITH-BACKEND-DOMAIN`).
- `src/components/RecoveryServicePage.jsx`, `InsuranceServicePage.jsx`, `DocumentationServicePage.jsx`: old copies. The live pages are in `src/components/services/`.
- `src/components/VehicleCard.jsx` and `src/constants.js`: imported nowhere.
- `backend/set_db_password.py`, `sync_db_credentials.py`, `verify_db.py`: one-off local helper scripts. They contain no secrets (passwords are typed in at runtime).

---

## C. Frontend findings

| ID | Sev | Where | Issue | Evidence | Impact | Fix | Verify |
|---|---|---|---|---|---|---|---|
| FE-01 | HIGH | `src/config/*.js`, `.env` (none exists) | Company phone, WhatsApp, email and address are empty. | Only `.env.example` exists. The code hides empty values by design. | The Contact page, footer and service pages show **no way to contact the company**. | Set `VITE_COMPANY_*` as build arguments in Coolify. | Load `/contact` on the deployed site and check that the phone and email appear. |
| FE-02 | MEDIUM | `src/components/AboutPage.jsx:121`, `src/components/Hero.jsx:6,10,14` | Images are hot-linked from Pinterest and from someone else's Cloudinary account. | Found by searching the source. | They can disappear at any time. There is a copyright risk, and the site depends on a third party. | Use licensed or client-owned images, saved in `public/images/`. | Search for `pinimg\|cloudinary` and expect 0 results. |
| FE-03 | MEDIUM | `src/components/services/RecoveryServicePage.jsx:11-32` (and the Documentation and Insurance pages) | The service pages make factual claims that nothing in the system backs up: "nationwide", "certified recovery flatbeds", "GPS-tracked delivery", "stockyards in Bengaluru, Mumbai, Delhi, Chennai", "Form 35 NOCs". | Source text. No backend feature or data exists for any of these services; their buttons only link to `/contact`. | Misleading advertising if the client does not actually offer these. | The client must confirm or rewrite every claim. | The client signs off on the page text. |
| FE-04 | LOW | `src/components/Hero.jsx` and others | 60 lint warnings (unused variables such as in `Navbar.jsx`, React compiler hints). 0 errors. | `npx oxlint src` | None for users. Code clutter. | Clean up. | `npm run lint` shows 0 warnings. |
| FE-05 | LOW | build output | The JS bundle is a single chunk larger than 500 kB. | Vite build warning. | Slower first load on mobile data. | Code-split the admin and dashboard routes with `React.lazy`. | The build shows no chunk warning. |
| FE-06 | LOW | `/api/auth/me` | Each anonymous page load makes a 401 request, which shows as a console error. | Site crawl on 31 Oct. | Noise only. | Optional: return 200 with `user:null`. | The console is clean when signed out. |
| FE-07 | LOW | `src/components/FaqPage.jsx` | The FAQ search box has no accessible label. | Site crawl on 31 Oct (not re-run today). | Screen-reader users. | Add `aria-label`. | Accessibility check. |
| FE-08 | LOW | `src/` | Abandoned files (see B). | Import scan. | Confusion for future developers. | Delete them after confirming with the team. | The build still passes. |

**Checked and found OK:**
- No `dangerouslySetInnerHTML` anywhere.
- No auth data in localStorage or sessionStorage.
- The post-login redirect uses `safeReturnPath` (prevents open redirects).
- Developer demo screens are removed from the production build: `npm run check:no-demo` passes both checks.
- No invented statistics or testimonials.

**Site crawl:**
- The 31 Oct crawl covered 29 routes at desktop and phone width. It found no broken internal links, broken images or horizontal overflow, and no page errors.
- That crawl was **not re-run today**. Only the pages changed since then were spot-checked in the browser.

---

## D. Backend findings

| ID | Sev | Where | Issue | Evidence | Impact | Fix | Verify |
|---|---|---|---|---|---|---|---|
| BE-01 | CRITICAL | `backend/app/core/config.py:156-160`, `services/orders.py:326` | Company bank details (`COMPANY_BANK_*`) are empty, and the startup check does not require them. | `.env` has 0 `BANK_` lines. `bank_details()` returns `None`. | A winner gets an order with **no account to pay into**, so the core money flow stops. | Set all five values in Coolify, and add them to the production startup check. | Win a test auction and confirm the order shows the bank details. |
| BE-02 | CRITICAL | `backend/app/core/config.py` (EMAIL) | SMTP is not configured. | The production startup check fails with "EMAIL_PROVIDER must be smtp". | Sign-up, email verification, password reset and notifications cannot reach users. The API **refuses to start** in production. | Enter the client's Zoho SMTP settings in Coolify. | Register a real address and receive the code. |
| BE-03 | CRITICAL | `config.py:101` `MOBILE_OTP_REQUIRED=True`, `services/sms.py` | Mobile OTP is on by default, but no SMS provider exists. | The production startup check fails with "MOBILE_OTP_REQUIRED needs a real SMS_PROVIDER". | The API refuses to start in production. | Either set `MOBILE_OTP_REQUIRED=false` for launch, or implement a provider (DLT + MSG91, or Firebase). | The API starts with `APP_ENV=production`. |
| BE-04 | HIGH | `backend/Dockerfile` (CMD `--forwarded-allow-ips "*"`), `app/core/rate_limit.py:162` | Clients can fake their IP address, so the per-IP rate limits can be bypassed. | Uvicorn 0.32.1 `proxy_headers.py:132-133`: when it trusts `*`, it takes the **first** (client-supplied) `X-Forwarded-For` value as `request.client.host`. `client_ip()` then trusts that value because `TRUSTED_PROXY_COUNT=0`. | Login, OTP and contact-form IP limits stop working: an attacker rotates fake IPs. Per-email limits still apply. | Set `--forwarded-allow-ips` to the proxy's network (not `*`), or remove `--proxy-headers` and use `TRUSTED_PROXY_COUNT`. | Send 50 logins with random `X-Forwarded-For` values. Expect a 429. |
| BE-05 | MEDIUM | `app/core/rate_limit.py:1-10` | Rate-limit counters live in memory. | A comment in the code says so. | They reset on every deploy or restart, and they only work with one worker (the Dockerfile uses one). | Accept for launch. Move to Redis later. | — |
| BE-06 | MEDIUM | `app/services/sms.py` | There is no per-mobile-number SMS limit. | The code has per-IP and per-email limits only. | Once real SMS is enabled, someone could make the site send many SMS (cost). | Add per-number and per-day limits together with the provider. | Test: the 6th request to one number in an hour returns 429. |
| BE-07 | LOW | `backend/requirements.txt` | pytest, pytest-asyncio and httpx are installed in the production image. `bcrypt` has no upper version bound. | File content. | Bigger image. A future bcrypt major version could break things. | Split dev requirements and pin bcrypt `<6`. | — |

**Checked and found OK:**
- All roughly 110 endpoints are behind proper guards. Admin routers have `require_role(["admin"])` at router level (`admin.py:86`, `admin_bulk.py:18`, `admin_search.py:37`).
- **All authenticated state-changing endpoints require the CSRF token.** This was checked by inspecting every route's dependencies in code: 0 missing.
- Orders and KYC documents check ownership. Another user's record returns 404 (`orders.py:65`), so there is no IDOR.
- Bidding locks the auction row (`SELECT … FOR UPDATE`) and re-checks KYC, blocks and unpaid wins after taking the lock. Idempotency keys are supported. The auction closer uses `SKIP LOCKED`.
- SQLAlchemy uses bound parameters throughout. No raw SQL built from strings was found.
- SMTP sending runs in a worker thread (`asyncio.to_thread`), so it does not block the server.
- API docs (`/docs`, `/openapi.json`) are switched off outside development (`main.py:57-59`).

---

## E. Admin dashboard findings

| ID | Sev | Where | Issue | Impact | Fix |
|---|---|---|---|---|---|
| AD-01 | MEDIUM | — | No first admin account exists in production yet. It has to be created with `python -m app.cli create-admin` (asks for the password interactively). | Nobody can run the site on day one. | Run it once after deploy, with the client present. |
| AD-02 | LOW | `src/admin/*` | Admin features are only tested against a **mocked API** in the browser, but every admin endpoint is tested against the real database in pytest (`test_users_admin`, `test_admin_search`, auctions, orders, KYC, parts, reports). | Low. | Add one real full-stack admin journey (see K). |

**Checked:**
- Admin protection is on the **server**, not only hidden in the UI. Tested by `smoke.spec.js` ("bidder cannot open /admin") and by backend role tests.
- Dashboard counts come from live SQL queries (`admin.py:457`), not hard-coded numbers.
- Admin actions are written to the audit log (`audit_logs` table).
- CRUD is complete for auctions, vehicles (including bulk Excel upload), spare parts, KYC decisions, users (suspend, reactivate, role, unblock bidding), orders (confirm or reject payment, complete, cancel), fees, enquiries and messages. There is also a monthly report with CSV export.

---

## F. Database findings

| ID | Sev | Issue | Evidence | Impact | Fix | Verify |
|---|---|---|---|---|---|---|
| DB-01 | HIGH | No automated backups are configured. | Backups are mentioned in `docs/` only. There is no script, schedule or Coolify config in the repo. | One bad command, or a disk failure, loses every user, bid, order and KYC record. | Turn on Coolify scheduled PostgreSQL backups (daily, kept 14+ days, stored off the server). Do a test restore once. | Restore the backup into a scratch database. |
| DB-02 | HIGH | Uploaded files (KYC documents, vehicle and part photos) live on disk at `/data/private`. | `backend/Dockerfile`, `KYC_STORAGE_DIR`. | Without a persistent volume, **every redeploy deletes all uploads**. They are also not included in DB backups. | Mount a Coolify persistent volume at `/data/private` and include it in backups. | Upload a photo, redeploy, check the photo is still there. |
| DB-03 | MEDIUM | Migrations are not run automatically on deploy. | `backend/Dockerfile` comment: "Run migrations once per release". | Deploying without migrating causes 500 errors. | Set Coolify's pre-deployment command to `alembic upgrade head`. | Check the deploy log. |
| DB-04 | MEDIUM | `backend/.env` on the laptop holds a remote database URL with its password in plain text (alongside the local one). | Two `DATABASE_URL` lines (values masked). The file was **never committed to git** (checked the full history). | If the laptop or the file leaks, the database is exposed. | Rotate that database password and keep only the local URL in `.env`. | Connecting with the old password fails. |

**Checked and found OK:**
- One migration head. The local DB is at head. `alembic check` reports that the models and migrations match.
- 71 indexes are declared.
- Row locking is used for bids, auction changes, OTP checks and admin edits.
- Status changes and their audit entries are saved in the same transaction (`services/orders.py:3`).

---

## G. Security findings (OWASP-style)

| Area | Result |
|---|---|
| SQL injection | OK: bound parameters throughout (ORM). |
| XSS | OK: React escapes output and there is no raw HTML. The API sends a CSP of `default-src 'none'`. **The website itself has no Content-Security-Policy** (SEC-03). |
| CSRF | OK: an Origin/Referer check (`core/middleware.py`) plus a per-session token on every authenticated write. |
| Broken access control / IDOR | OK: roles are read from the DB on every request, and ownership is checked on orders, KYC, notifications and vehicles. |
| Sessions | OK: server-side sessions, HttpOnly, `Secure` in production, `__Host-` cookie prefix, SameSite=Lax, idle timeout, maximum sessions per user, logout from all devices. |
| Passwords | OK: bcrypt with 12 rounds and SHA-256 pre-hash, plus a password policy. |
| Rate limiting | **Weak: SEC-01 (= BE-04)**, IP spoofing. |
| File uploads | OK: type detected from the file bytes, size limits, PDFs with active content rejected, random storage names, path traversal blocked (`storage.py:42`), downloads sent as attachments. |
| CORS | OK: explicit origins only. Production refuses wildcards, localhost and http. |
| Security headers | API: nosniff, DENY, no-referrer, CSP, HSTS in production. nginx: nosniff, DENY, Referrer-Policy. HSTS and CSP are missing on the website (SEC-03). |
| Secrets | OK: no secrets in git (full history checked). `.env` is git-ignored and docker-ignored. |
| Dependencies | **SEC-02: react-router 7.1.5 has 3 high-severity advisories.** |

| ID | Sev | Issue | Evidence | Fix | Verify |
|---|---|---|---|---|---|
| SEC-01 | HIGH | See BE-04. | — | — | — |
| SEC-02 | HIGH | `react-router-dom` is pinned at 7.1.5, which has known high-severity advisories: open-redirect XSS (≤7.11.0), external redirect via untrusted paths (<7.9.6), and turbo-stream DoS. | `npm audit`: 7 high, 0 critical. | Upgrade to `react-router-dom@7.18.6` (same major version, a fix is available) and re-run the e2e tests. Real-world exposure is lowered because the app uses `safeReturnPath` and not framework mode. | `npm audit` shows 0 high. |
| SEC-03 | MEDIUM | The website (nginx) sends no `Content-Security-Policy` and no `Strict-Transport-Security`. | `deploy/nginx.conf.template`. | Add HSTS (once HTTPS works) and a CSP allowing self plus the font and image hosts. | `curl -I https://salvexauction.com`. |
| SEC-04 | LOW | Python dependencies were not scanned: `pip-audit` is not installed. Versions are recent (FastAPI 0.115.14, Starlette 0.46.2, h11 0.16.0). | — | Run `pip-audit` in CI. | — |

---

## H. Functional testing results (executed today)

| Test | Result | Notes |
|---|---|---|
| Backend pytest (real PostgreSQL test DB) | **543 passed, 0 failed** (10 min 18 s) | Covers auth, OTP, mobile OTP, KYC, vehicles, auctions, bidding concurrency, orders, fees, reports, admin, search, parts, enquiries, notifications, security middleware and config safety. |
| Frontend Playwright (desktop, mobile, demo) | **209 passed, 1 failed, 38 skipped** of 248 | The one failure was the admin page's "Demo screens" label, which disappeared after the admin top-bar change. It was fixed in commit `cf7c0a1`. The affected files were re-run: **4 passed, 2 skipped**. The full suite was **not** re-run after the fix. Skips are tests that only apply to the other screen size. |
| Production build (`vite build`) | Pass | Warning about chunk size. |
| `check:no-demo` | Pass (both cases) | |
| Lint (`oxlint`) | 0 errors, 60 warnings | |
| Production startup check (`APP_ENV=production`, current `.env`) | **Refuses to start** (correct behaviour) | Reasons: SMTP not set; SMS missing while OTP required; origins are localhost. |
| Alembic heads / current / check | Pass | |

**Important limit:**
- **All 25 Playwright files use a mocked API** (`mockApi` / `page.route`).
- So the browser tests prove the UI behaves correctly for given API answers. They do **not** prove the browser and the real backend work together.
- The backend tests prove the API and database work.
- A real browser → API → database journey was last exercised by hand on 31 Oct (sign-in as a temporary admin and buyer, all admin sections and dashboard tabs). It was **NOT re-verified today**.

---

## I. Production deployment findings

| ID | Sev | Issue | Evidence | Fix |
|---|---|---|---|---|
| DEP-01 | CRITICAL | Nothing is deployed. `https://salvexauction.com` returns a Hostinger "Parked Domain" page. | `curl` today: title "Parked Domain name on Hostinger DNS system". | Deploy on Coolify, point DNS at the server, issue HTTPS certificates. |
| DEP-02 | HIGH | The latest work exists only on the laptop. Commits `41a2b00` and `cf7c0a1` are not on any remote. `origin` (Faheem10-web/beta-salvex) has only `main`. `personal` (safeerzaid/salvex) is at the older `fa815e8`. | `git ls-remote` | Push the branch today (Coolify also needs it to build). |
| DEP-03 | HIGH | No production environment values exist yet: `APP_ENV=production`, `APP_SECRET_KEY` (new, 32+ chars), `DATABASE_URL`, `FRONTEND_ORIGINS=https://salvexauction.com`, SMTP, bank details, `MOBILE_OTP_REQUIRED`. | Startup check output. | Enter them in Coolify. The startup check will name anything missing. |
| DEP-04 | MEDIUM | No monitoring or error alerts. Logs go to stdout only. There is a health endpoint (`/api/health`), but neither Dockerfile has a `HEALTHCHECK`. | `main.py`, Dockerfiles | Turn on Coolify health checks and uptime alerts. Add Sentry or similar later. |
| DEP-05 | MEDIUM | No rollback procedure is written down. | — | Coolify keeps earlier images: write down "redeploy previous". Migrations need a backup taken before each release. |
| DEP-06 | LOW | `vercel.json` and `server/` are leftovers that could mislead a deployer. | — | Remove them. |
| DEP-07 | LOW | The sitemap and robots files assume the domain `salvexauction.com`. | `public/sitemap.xml`, `robots.txt` | Confirm the final domain. |

**Checked and found OK:**
- Single-domain design: nginx forwards `/api` to the backend, so the browser sees one origin.
- gzip compression and cache headers are set.
- The backend container runs as a non-root user.
- There is one worker, by design.

---

## J. Fake, mock, incomplete or not-working features

| Feature | Status |
|---|---|
| SMS / mobile OTP | **Not working.** Codes go only to a developer log file. No provider exists. |
| Email delivery | **Not working until configured.** The code is complete; settings are missing. |
| Payment | **Partial by design.** No gateway. Bank transfer plus UTR, confirmed by an admin. Bank details are missing (BE-01). |
| Insurance / Recovery / Documentation services | **Information pages only.** Every button goes to `/contact`. There is no booking or quote feature, and the claims are unverified (FE-03). |
| Legal pages | **Draft text.** The data says `lastUpdated: 'Draft – pending company approval'` (`siteContent.js:162`), but the page does not show this. The refund page is titled "Earnest Money Deposit (EMD)" with a section called "Refundable Security Deposit", yet its text says "No deposit is needed", and the backend takes no deposit (`models/user.py:105`). The jurisdiction says "Bengaluru, Karnataka" (`LegalPage.jsx:97`), which nobody has confirmed. **The client's lawyer must supply the final text.** |
| Company contact details | **Empty** (FE-01). |
| Developer demo screens | Mock, but correctly stripped from production builds. |
| Seller self-service (`/sell`, seller dashboard) | Code and API exist (`/api/vehicles/*`, seller role). **NOT VERIFIED** end-to-end today, and it is unclear whether the client wants public sellers at all. |

No fake statistics, testimonials, ratings or invented phone numbers were found.

---

## K. Missing tests

1. **A real full-stack browser journey** (no mocks): register → verify email → KYC upload → admin approves → bid → auction closes → order → submit UTR → admin confirms → receipt.
2. A test that the server refuses to start in production without bank details (once BE-01 is fixed).
3. A rate-limit test with a fake `X-Forwarded-For`, run behind the real proxy setup (BE-04).
4. A per-mobile-number SMS limit test (when SMS is added).
5. Backup restore drill (manual).
6. Deployed smoke test: HTTPS, headers, `/api/health`, cookies are `Secure` and `__Host-`.
7. Python dependency scan (`pip-audit`) in CI.

---

## L. Prioritized remediation plan

**Before launch (blockers): needs the client for items 1–5**
1. Push the code to GitHub (DEP-02). *Developer, 5 min.*
2. Get the client's Zoho SMTP details and test with a real email (BE-02). *Client + developer.*
3. Decide on SMS: for launch, `MOBILE_OTP_REQUIRED=false` (BE-03). *Decision.*
4. Get the company bank details, and add them to the startup check (BE-01). *Client + small code change.*
5. Get the company phone, email and address (FE-01) and the approved legal text (J). *Client.*
6. Fix trusted-proxy IP handling (BE-04). *Small code change.*
7. Upgrade react-router-dom to 7.18.6 and re-run the full e2e suite (SEC-02). *Small.*
8. Coolify setup: PostgreSQL, persistent volume `/data/private`, daily backups, environment values, migrations as the pre-deploy command, health check (DEP-01, DEP-03, DB-01..03). *Developer + Coolify access.*
9. Point DNS to the server, get HTTPS, create the first admin (AD-01), run the deployed smoke test (K6).

**First week after launch**
10. Replace the hot-linked images (FE-02). The client confirms the service-page text (FE-03).
11. Rotate the remote DB password and clean `.env` (DB-04).
12. Uptime monitoring and error alerts (DEP-04). Website CSP and HSTS (SEC-03).
13. Add the full-stack journey test (K1).

**Later**
14. Real SMS provider (DLT + MSG91, or Firebase) with per-number limits.
15. Redis rate limiter, code splitting, clean up lint and abandoned files.

---

## Totals

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 4 | BE-01, BE-02, BE-03, DEP-01 |
| HIGH | 8 | FE-01, BE-04 (same as SEC-01), SEC-02, DB-01, DB-02, DEP-02, DEP-03, draft legal text (section J) |
| MEDIUM | 10 | FE-02, FE-03, BE-05, BE-06, AD-01, DB-03, DB-04, SEC-03, DEP-04, DEP-05 |
| LOW | 10 | FE-04, FE-05, FE-06, FE-07, FE-08, BE-07, AD-02, SEC-04, DEP-06, DEP-07 |
| **Total** | **32** | |

### Critical blockers preventing production deployment
1. Not deployed. The domain is parked (DEP-01).
2. SMTP not configured. The API will not start in production (BE-02).
3. SMS required but missing. The API will not start in production (BE-03).
4. No bank details, so winners cannot pay (BE-01).

### Features that are genuinely working (evidence: backend tests against a real DB, plus the 31 Oct manual run)
- Registration, email verification, login and logout, logout from all devices, password reset, sessions, CSRF.
- KYC submission with document upload, admin review (approve or reject), secure document download.
- Vehicles: add, edit, photos (crop, order, thumbnail), review, bulk Excel upload, publish, mark sold or reopen.
- Auctions: create, schedule, pause, resume, extend, cancel, close; automatic closing; time extension; bidding with row locking; bid history.
- Orders: creation on win, payment deadline, reminders, automatic default and bidding block, UTR submission, admin confirm or reject, deal and service fees, receipt.
- Ready to Lift catalogue with "I'm interested" enquiries. Spare parts catalogue with part requests. Contact form.
- Notifications (in-app). Admin search, buyer and vehicle overviews, monthly report with CSV export, audit log.
- Role-based access on the server.

### Partially working
- Email: code complete, not configured.
- Payment: manual bank transfer only; bank details missing.
- Mobile verification: complete flow, but codes are only written to a developer log.
- Service pages: information only.
- Legal pages: draft.
- Rate limiting: works per email; per IP it can be spoofed.

### Not working
- SMS delivery.
- Live website (not deployed).
- Backups.

### Items that could not be verified
- Production / Coolify environment, HTTPS, DNS, persistent volumes and backups (none exist yet).
- Real SMTP delivery and inbox placement (no credentials).
- A full browser → real API journey today (last done 31 Oct; the Playwright suite uses mocks).
- The full Playwright suite after the final one-line fix (only the affected files were re-run).
- Python dependency vulnerabilities (`pip-audit` not installed).
- Seller self-service flow end-to-end.
- Performance under load (no load test exists).
- The accuracy of the business claims on the service and legal pages (only the client can confirm).

---

## Phase 2 – Critical code remediation (23 November 2026)

Six local commits on `feature/full-frontend`, on top of `cf7c0a1`. **Not pushed, not deployed.**

| Finding | Status | Commit | What changed |
|---|---|---|---|
| BE-04 / SEC-01 IP spoofing | **Fixed** | `ef94140` | uvicorn runs with `--no-proxy-headers`. The app reads `X-Forwarded-For` only when `TRUSTED_PROXY_COUNT > 0` **and** the connection comes from `TRUSTED_PROXY_NETWORKS` (private networks). It takes the entry that many places from the right, so anything a client writes further left is ignored. Production logs a warning when the count is 0. Coolify value: **2**. |
| BE-01 Bank details | **Fixed, severity corrected** | `ff97e24` | **Correction:** with `ONLINE_PAYMENT_FLOW=false` (the default and the client's setting), the website takes no payment and never shows bank details. The team contacts the winner (`services/orders.py:101`). BE-01 is therefore **not a blocker** for this client. When `ONLINE_PAYMENT_FLOW=true`, production now refuses to start unless account name, account number, IFSC and bank name are set. The IFSC and account number are format-checked. Nothing is hard-coded. |
| SEC-02 react-router | **Fixed** | `31f7611` | react-router-dom 7.18.6 and vite 8.3.8. `npm audit --omit=dev`: 0. |
| SEC-03 Website CSP / HSTS | **Fixed (nginx runtime NOT VERIFIED)** | `01c3971` | `deploy/security-headers.conf` is included in every website location. It has a CSP with no `unsafe-inline` or `eval`, and HSTS only on HTTPS requests. Verified in a real browser against the production build (`npm run check:csp`) and by nginx-structure tests. nginx itself was **not** run: Docker is not running on this machine and downloading nginx was not permitted. |
| SEC-04 Python dependencies | **Partly fixed** | `5a7731c`, `01c3971` | Production and dev requirements split. bcrypt pinned to `>=5,<6`. python-dotenv 1.2.2+ and dnspython 2.9.2+ patched. pip-audit added to CI. **starlette 0.46.2 still has 7 advisories** (fix needs a FastAPI upgrade to starlette ≥ 1.3.1). The affected features (FileResponse, StaticFiles, form and multipart parsing, HTTPEndpoint, `request.url` in security checks) are not used, so they are listed as reviewed exceptions in CI. |
| DB-03 / DEP-05 Release safety | **Documented** | `12d3659` | `docs/RELEASE_RUNBOOK.md`: preflight checklist, mandatory backup before migration, migration procedure, smoke test, rollback (3 levels). `HANDOVER.md` corrected (proxy count 2, the image does not migrate on its own, EXIF line, test commands). |

### Final verification (run on the final code)

| Check | Result |
|---|---|
| Backend pytest | **572 passed, 0 failed** (543 before + 29 new) |
| Playwright, full suite (desktop, mobile, demo) | **210 passed, 0 failed, 38 skipped** (skips = tests for the other screen size) |
| `npm run check:csp` (production build in a browser) | 4 passed |
| `npm run build` | pass (chunk-size warning, FE-05) |
| `npm run lint` | 0 errors, 60 warnings (unchanged) |
| `npm run check:no-demo` | pass (both cases) |
| `npm audit --omit=dev` | **0 vulnerabilities** |
| `npm audit` (including dev tools) | 2 high: `playwright` < 1.55.1 (browser download without certificate check). Test tool only, not shipped. |
| `pip-audit` (installed environment) | Production packages: only the 7 reviewed starlette advisories. Also pip 24.0 (installer, not in requirements) and pytest 8.3.5 (test tool only). |
| `alembic heads` / `current` / `check` | one head `e8a3c5f1b7d9`, local DB at head, models match migrations |

### Still blocking production delivery (unchanged by Phase 2)

1. **DEP-01** Not deployed. The domain is parked.
2. **BE-02** SMTP not configured. The API will not start in production.
3. **BE-03** `MOBILE_OTP_REQUIRED=true` without an SMS provider. Set `false` for launch, or the API will not start.
4. **DEP-02** Commits exist only on the laptop.
5. **DB-01 / DB-02** No backups and no persistent volume yet (to set up in Coolify; procedure in RELEASE_RUNBOOK.md).
6. Client inputs: company contact details (FE-01), approved legal text, confirmation of the service-page claims (FE-03), replacement images (FE-02).

**This application is not production-ready yet.** The code fixes above remove the security findings that could be fixed in code. The blockers left are deployment, configuration and client content.
