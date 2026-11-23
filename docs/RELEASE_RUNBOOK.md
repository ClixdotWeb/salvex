# Salvex Auction: Release Runbook

How to release a new version to Coolify safely: what to check first, how to migrate the database, and how to go back.

Every release follows the same order:
**preflight → backup → migrate → deploy → smoke test.**
If anything fails, see **Rollback** at the end.

Related: [HANDOVER.md](HANDOVER.md) (first setup), `backend/.env.example` (every setting).

---

## 1. Preflight checklist (before every release)

Do not start the release until every box is ticked.

**Code**
- [ ] The release commit is pushed and CI is green: lint, build, demo check, CSP check, pip-audit, backend tests.
- [ ] Locally, or in CI, on the release commit:
  - [ ] `cd backend && .venv\Scripts\python -m pytest -q -p no:cacheprovider`: all pass
  - [ ] `npx playwright test`: all pass (desktop, mobile, demo)
  - [ ] `npm run lint`, `npm run build`, `npm run check:no-demo`, `npm run check:csp`
  - [ ] `npm audit --omit=dev`: 0 vulnerabilities
- [ ] `cd backend && alembic heads` shows **one** head.
- [ ] `alembic check` says "No new upgrade operations detected".
- [ ] Note the commit hash being released, and the hash currently live (for rollback).

**Migrations in this release**
- [ ] List the new files in `backend/alembic/versions/` since the live commit:
      `git diff --name-only <live-hash> <release-hash> -- backend/alembic/versions`
- [ ] For each one, read `upgrade()` and `downgrade()` and decide:
  - **Additive** (new table, new nullable column, new index): safe. The old code keeps working with the new schema.
  - **Destructive** (drop or rename a column or table, change a type, delete data): needs the backup in step 2 **and** a planned maintenance window. `downgrade()` cannot bring back deleted data.

**Configuration (Coolify → backend service → Environment)**
- [ ] `APP_ENV=production`
- [ ] `APP_SECRET_KEY` is long and random (never reuse the development one).
- [ ] `DATABASE_URL` uses the private Coolify address.
- [ ] `FRONTEND_ORIGINS` and `PUBLIC_SITE_URL` use the live `https://` domain.
- [ ] `TRUSTED_PROXY_COUNT=2` (Coolify's proxy plus the website's nginx).
- [ ] `EMAIL_PROVIDER=smtp` with all `SMTP_*` values.
- [ ] `MOBILE_OTP_REQUIRED=false` until a real SMS provider exists.
- [ ] `ONLINE_PAYMENT_FLOW`: `false` for this client. If `true`, all four `COMPANY_BANK_*` values are required.
- [ ] Persistent volume mounted at `/data/private` (`KYC_STORAGE_DIR`).

The API refuses to start if a required value is missing or unsafe, and the log names the setting. That is the last line of defence, not the check.

**Website service (Coolify → website)**
- [ ] Build arguments `VITE_COMPANY_*` are set (phone, WhatsApp, email, address, city).
- [ ] Runtime `BACKEND_URL` points to the backend service, e.g. `http://salvex-api:8000`.

---

## 2. Backup before migration (mandatory)

**Never run a migration without a fresh backup taken minutes before.** A scheduled nightly backup is not enough: everything since then would be lost.

1. **Database:** Coolify → the PostgreSQL resource → Backups → **Backup now**.
   Wait until it shows as successful, and note its name and time.
   Without Coolify backups, run this from the database container's terminal:
   ```bash
   pg_dump -U <db-user> -d <db-name> -Fc -f /backups/salvex-$(date +%Y%m%d-%H%M).dump
   ```
   Copy the file **off the server** (download it, or use S3 backup storage in Coolify).
2. **Uploaded files:** back up the `/data/private` volume at the same time (Coolify volume backup, or `tar`). A database without its matching files shows vehicles without photos and missing KYC documents.
3. **Check the backup is usable** at least once a month: restore it into a scratch database and open a few records. A backup that was never restored is not proven.

Keep daily scheduled backups too: at least 14 days, stored off the server.

---

## 3. Database migration procedure

Migrations run **once per release, before the new backend starts.**

**Coolify (recommended):** set the backend service's **Pre-deployment command** to:
```bash
alembic upgrade head
```
Coolify runs it in the new image and stops the deploy if it fails. The old version keeps running.

**Manual (if no pre-deployment command is set):** open the backend container terminal and run:
```bash
alembic current          # note the revision before
alembic upgrade head
alembic current          # must now show the newest revision with (head)
```

**Rules**
- Never edit a migration that has already run in production. Write a new one.
- Never run `alembic downgrade` in production without the backup from step 2 (see Rollback).
- One release, one `upgrade head`. Do not run individual revisions by hand.
- Never run the test suite against the production database. The test runner refuses non-local databases and names without "test".

---

## 4. Deploy and smoke test

1. Deploy the backend (the pre-deployment command migrates first), then the website.
2. In the backend logs:
   - "Application startup complete"
   - no "Unsafe configuration"
   - no `TRUSTED_PROXY_COUNT=0` warning
3. Smoke test in a private browser window:
   - [ ] `https://<domain>/api/health` returns OK.
   - [ ] `curl -sI https://<domain>/` shows `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`.
   - [ ] The home page, an auction page and the contact page load. The browser console shows no "Content Security Policy" errors.
   - [ ] Register a real email address and receive the code (real SMTP). Then sign in and out.
   - [ ] Sign in as admin: the dashboard numbers load, and a KYC document and a vehicle photo open (this proves the volume is mounted).
   - [ ] Five wrong passwords in a row are blocked (429). A different network is not blocked (rate limits see real client addresses).
4. Write down the release: date, commit hash, migrations run, backup name.

---

## 5. Rollback

Choose the smallest step that fixes the problem.

**A. The new version misbehaves, and the release had no migration (or only additive ones)**
1. Coolify → the service → Deployments → redeploy the **previous** deployment (or the previous commit hash).
2. An additive schema is compatible with the older code, so the database stays as it is.
3. Smoke test again (section 4).

**B. The release had a migration that must be undone, and no important new data was written**
1. Stop the backend, or put up a maintenance notice.
2. From the new image's terminal: `alembic downgrade <revision-before>`, the revision noted in step 3.
3. Redeploy the previous version (A).
4. Smoke test.

**C. Data is damaged, or a destructive migration went wrong**
1. Stop the backend so nothing more is written.
2. Restore the database from the backup taken in step 2 (Coolify → Backups → Restore, or `pg_restore -c -d <db-name> <file>.dump`).
3. Restore the `/data/private` volume from the same moment.
4. Redeploy the previous version (A).
5. Smoke test.
6. Tell the client which time window of activity was lost (bids or registrations made between the backup and the stop).

**Never:**
- force-push over the live commit
- delete the backup used for a rollback
- run `downgrade` "to see what happens"
