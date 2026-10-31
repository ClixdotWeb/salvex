# Salvex Master Development Plan (4-day delivery)

This is the single roadmap for the Salvex project. It records the approved plan and how far the work has
got. Update the **Progress** section as each module is finished; do not replace the plan with a different
roadmap without agreement.

Authoritative technical references: `docs/AUTHENTICATION.md` (authentication and deployment of the login
system) and `backend/README.md` (local setup). The older reports in `docs/archive/` are historical and
not authoritative. **No client requirements document has been found in the repository**; if one exists
it should be added and the decisions below checked against it.

## 1. Goal and honest target

Deliver the full required Salvex scope in four days. Everything in the scope cannot be made
production-ready in four days (the business modules are mostly missing, and several need company
decisions about payment, fees, tax, KYC rules and hosting). The best achievable target is:

> A working, **tested core platform in a staging environment**: users register, verify and pass KYC;
> admins manage users and vehicles; sellers submit vehicles; admins schedule auctions; bidders bid with
> safe concurrency; the server closes auctions and picks winners; orders are created and payments are
> recorded and confirmed by an admin (bank transfer); Ready to Lift, affidavit and gate pass run as
> separate states; every admin action is audit-logged; basic reports and CSV export work.

Anything not finished is either built in a smaller form, clearly labelled **Demo**, or recorded as blocked.
Nothing misleading stays on screen. A real launch additionally needs the company decisions in section 6,
real hosting, real email, a prepared database, and a security review.

## 2. Ground rules (apply to every module)

* Backend is the authority: deny by default, owner-or-admin access, roles read from the database. Frontend
  route guards only decide what is shown.
* Strict request schemas (unknown fields rejected); page-size cap on every list; money as exact decimals.
* Every sensitive admin action writes an audit row **in the same transaction** (`app/core/audit.py`).
* One Alembic migration at a time, tested upgrade / downgrade / upgrade on the isolated test database
  (`salvex_test_db`) before anything else. Never run anything against the company database.
* Tests run sequentially on `salvex_test_db` only (guarded by `backend/tests/safe_db.py`).
* No secrets in the repository, logs or frontend. The company database credential that was exposed earlier
  must be treated as compromised and rotated before that database is ever used.
* Demo screens stay visible but are labelled **Demo**; they never claim an action the server did not record.

## 3. Modules, dependencies and acceptance criteria

| # | Module | What to build | Needs | Minimum acceptance |
|---|---|---|---|---|
| 0 | Truthful UI | Label demo screens; remove fake success/Verified/Paid/Issued/Reconciled states and the fake KYC badge; show the real KYC status | none | No screen claims an action the server did not record; lint 0 errors; browser tests pass |
| 1 | Foundation | Append-only `audit_logs`; suspension fields; `/api/admin` router with `require_role`; pagination/response helpers; CI; this plan | none | Admin actions audit in one transaction; 401/403 enforced; migration up/down/up; CI configured |
| 2 | Users and admin | Admin user list/search/detail, suspend/reactivate/role change (revokes sessions, audited), `users/me`, buyer ID | 1 | 401/403; no hash/token in any response; suspended user's token dies at once |
| 3 | KYC and documents | Submissions, documents, decisions (append-only); upload checks; private storage behind an adapter; admin review; `require_verified_kyc` | 1, 2 | Bad files refused; user A cannot read user B's file; every decision has reviewer, time, reason |
| 4 | Vehicles | Vehicle separate from auction listing; registration number/VIN uniqueness; photos/documents; seller draft/submit/edit; admin review; public catalogue API; registration lookup | 1, 2 | Duplicates refused; seller edits only own; public sees only published rows |
| 5 | Auctions | Status machine with allowed transitions; CHECK constraints; admin schedule/pause/resume/extend/close with history | 4 | Invalid transitions refused; every change recorded |
| 6 | Bidding engine | Row-locked bid transaction, server-time checks, increment from the listing, KYC check, append-only bids, idempotency key, rate limit, masked history | 3, 5 | 50 simultaneous bids stay consistent; boundary-time tests; no bid edit/delete |
| 7 | Auto-close and winner | Scheduler/worker with single-run guarantee; winner, reserve result, no-sale | 6 | Test clock proves boundaries; two workers close an auction once |
| 8 | Orders and payments | Orders/lines, versioned fee rules, payment attempts, payments, append-only ledger, state machine, admin confirmation of bank transfers, gateway-neutral interface | 7 | Client cannot influence amounts; ownership enforced; duplicate reference refused; ledger immutable |
| 9 | Invoices, receipts, refunds, payouts | Sequential numbering, PDFs, credit notes, refund records, seller settlements | 8 | No gaps/duplicates in numbering; refunds keep history |
| 10 | Ready to Lift and collection | Affidavit, gate pass, collection as separate states | 8 | No gate pass without cleared payment and accepted affidavit; only owner/yard staff can read; release recorded once |
| 11 | Service requests | Generic request model: insurance, recovery, collection booking, documentation, sell-assist | 1, 2 | Survives refresh; in user history; status changes audited |
| 12 | Complaints and notifications | Complaints with comments/status; in-app notifications; email delivery status | 1, 2 | Owner-or-admin access; delivery state stored |
| 13 | Spare parts and used vehicles | Auction listing types, or fixed-price catalogue/stock/orders (company decision) | 4, 8 | No negative stock; server-side prices; order ownership |
| 14 | History, search, reports | Vehicle/user history, monthly and all-time reports, CSV export (formula-safe), CSV import with dry-run | 4-10 | Figures match direct queries; import all-or-nothing |
| 15 | Frontend integration | Replace each mock array; server-clock countdowns; loading/error states | each backend module | Browser tests against the real stack |
| 16 | Deployment and operations | Fix `vercel.json`/proxy wiring; process config; staging; backups and restore test; monitoring; shared rate limiter; trusted hosts; pinned dependencies; dependency audits | decisions | Staging works end to end; restore tested |

Order: **0 and 1, then 2, then 3, then 4 and 5, then 6, 7, 8, then 9 and 10, then 14 and 16.** Modules 11, 12
and frontend integration can run in parallel with the backend work that does not share their files.
Never run two migrations or two changes to bidding/ledger code in parallel.

## 4. Four-day schedule

**Day 1 - truth, foundation, users, KYC groundwork.** Module 0; Module 1; Module 2; start Module 3.
Send the decision list (section 6) to the company; rotate the exposed database credential.
Gate: all backend tests green, lint 0 errors, no fake KYC badge. Fallback: move `users/me` editing and
CSV-ready search to Day 4.

**Day 2 - KYC, vehicles, auctions, bidding.** Finish Module 3; Modules 4 and 5; Module 6 (highest risk,
start by midday); Module 7. Gate: the concurrent-bid test passes repeatedly; unverified-KYC user refused.
Fallback: if concurrency tests show design problems, stop adding features and fix the engine; move
anti-sniping and proxy bids after launch.

**Day 3 - money and collection.** Module 8; minimum of Module 9; Module 10; Modules 11 and 12 in parallel;
frontend integration for catalogue, auction, bidding, payment and dashboards. Gate: a full flow works on
the real stack with staging data (register, KYC, list, approve, auction, bid, close, order, payment confirmed
by admin, invoice, affidavit, gate pass, collection). Fallback: bank-transfer reconciliation only; no refunds
beyond records; no payouts.

**Day 4 - reports, remaining modules, hardening, delivery.** Module 14; Module 13 in the chosen form;
Module 16; full verification; handover documents. Fallback: drop CSV import, the spare-part shop and payouts
first. Never drop tests, audit logging or the truthfulness work.

## 5. Final delivery checklist

- [ ] Backend tests pass (sequential, `salvex_test_db` only), including new tests for every module.
- [ ] Concurrency tests pass repeatedly: bidding race, payment duplicates, closing job run twice.
- [ ] Browser tests cover each flow against the real backend.
- [ ] Authorization matrix: anonymous / bidder / seller / admin for every endpoint, plus IDOR cases.
- [ ] Security: no secrets in the repo or frontend bundle; `npm run check:no-demo`; uploads validated;
      `npm audit` and `pip-audit` completed and recorded; rate limiter correct across processes.
- [ ] Migrations tested up, down and up on a copy; models match the database (0 differences).
- [ ] Integrity: ledger append-only, invoice numbers continuous, `current_bid` equals the bids table.
- [ ] Production configuration: environment validation, HTTPS, cookies, trusted hosts, API wiring verified.
- [ ] Backup and restore verified; monitoring and alerts demonstrated.
- [ ] Known limitations and handover documents written.

## 6. Company decisions needed

| Decision | Blocks | Can proceed meanwhile with |
|---|---|---|
| Auction rules: reserve, ties, extension (anti-sniping), bid visibility, proxy bids | Final rules in modules 5-7 | Configurable rules with documented defaults to be confirmed |
| KYC: required documents, retention, third-party provider | Final KYC fields | Generic document-type list |
| Payment method, fees, taxes, EMD, deadlines, refunds, payouts | Real payments, invoices, refunds | Bank-transfer reconciliation and configurable fee rules (no invented numbers) |
| Ready to Lift, affidavit, gate-pass rules | Final content of module 10 | State machine and permissions |
| Fixed price vs auction for spare parts and used vehicles | Module 13 design | Auction-type listings |
| Hosting, domain, email provider, file storage, backup, monitoring | Real deployment, emails, storage | Local development and staging adapters |
| Use of the company database | Any use of it | All local work. Credential must be rotated, a dedicated database prepared and SSL confirmed first |
| Buyer ID and registration-number formats | Final IDs and search | A provisional unique format |
| Legal and tax review (DPDP, invoices, auction terms) | Launch | Everything else |

### Decisions received so far (2026-10-22, relayed by the developer; to be confirmed in writing by the company)

| Topic | Decision | Still open |
|---|---|---|
| Company database | Private Coolify database; reachable only from the Coolify network. Backend must be deployed on the same Coolify server. Local development uses the local database. | Deploy access, domain, storage volume, database name (`postgres` vs `postgress`) |
| Email | SMTP details will be provided on request | Details |
| Payment method | Payment gateway (recommended: Razorpay) | Company account and keys; who bears gateway fees on large amounts; whether large amounts also go by bank transfer |
| EMD (deposit) | **Not required** | - |
| Refunds and post-payment steps | Handled **manually** by the company; the platform only records them | - |
| Payment deadline / non-payment | Company to answer | Yes |
| Starting price and bid amounts | Admin sets a **starting price** per auction. The first bid must be at least the starting price; every later bid only has to be **higher than the current highest bid** - no fixed minimum increment | - |
| Time extension for late bids (anti-sniping) | **Admin panel switch** per auction, with configurable minutes | Default minutes |
| Equal bids | Cannot occur: bids are processed one at a time and each must exceed the current bid; the first one received wins | - |
| Proxy (automatic) bidding | Not decided | Yes (recommended: after launch) |
| KYC documents | Use a common list (identity, address, company/GST, bank proof for sellers) | Company confirmation of the list |
| Vehicle details | Company field list, all mandatory, whoever adds the vehicle (seller or admin), plus photos: registration number, claim number, make, model, variant, manufacturing year, registration year, fuel type, transmission, number of owners, damage type, location, RC status, registration type, hypothecation status | Option lists for the choice fields; photo minimum/maximum; whether chassis number is also needed |
| Buyer ID | **`SLX-000123`** (SLX + 6-digit sequential number), confirmed | Whether sellers also get an ID |
| Affidavit / gate pass | Explained to the company | Template and who issues |
| Spare parts | **Fixed price**. Show a small catalogue; users search by vehicle (make, model, year) and part. If the part is not listed, the user sends a **part request** (vehicle + part needed); the admin is **notified**, updates the request (status, reply, price) and the user is **notified of each update** (in-app; email once SMTP is set up) | Request statuses |
| Terms, privacy, auction terms | Normally provided by the company; developers can prepare drafts for legal approval | Approval |

## 7. Known risks

* The bidding engine is the hardest part; a slip on Day 2 delays everything after it.
* The scope is larger than four days of verified work; quality is protected by cutting scope, never tests.
* Payments without a gateway decision limit what can be proven.
* This development computer has limited memory: run test suites one at a time.
* Anything delivered in four days is staging-grade and needs a security review before real users and money.

## 8. Progress

| Module | Status | Notes |
|---|---|---|
| 0 Truthful UI | **Done** | Demo screens first labelled, then (2026-10-23) replaced by real pages and deleted. |
| 1 Foundation | **Done** (awaiting review) | `audit_logs` (append-only, trigger-enforced); `users.suspended_at/suspension_reason/suspended_by_id`; `/api/admin` router (admin-only; first route `GET /api/admin/audit-logs`); `PaginationParams`/`paginate`/`Page`; `record_audit`; CI in `.github/workflows/ci.yml`. Migration `a4d81c6e5b20` applied to `salvex_test_db` only. **The development database `salvex_auction` has not been migrated** - see below. |
| 2 Users and admin | **Done except buyer ID** (reviewed 2026-10-22; one locking defect fixed) | See "Module 2 details" below. No migration needed (uses existing columns). Buyer ID **blocked** on a company decision. |
| 3 KYC and documents | **Backend done with provisional rules** (awaiting review) | See "Module 3 details" below. Migration `5c3e9a7b1f42` applied (up/down/up) to `salvex_test_db` only. Document list, retention, scanning and production storage **blocked** on company decisions. Frontend not wired (Module 15). |
| 4 Vehicles | **Backend done** (awaiting review) | New `vehicles` + `vehicle_photos` tables (migration `8d1f6b2a9c47`, up/down/up on `salvex_test_db` only); the legacy `vehicle_lots` table is untouched. Company field list, all mandatory; sellers and admins add vehicles; draft -> submitted -> approved / rejected / changes_requested; one active vehicle per registration number; photos JPEG/PNG (1-20, 5 MB, provisional); admin edits audit-logged; public catalogue `/api/catalogue/vehicles` shows approved vehicles only, registration masked, no claim number or owner. Option lists for choice fields are provisional (`app/models/vehicle.py`). Tests: `tests/test_vehicles.py` (48). Full suite 390 passed. Frontend not wired (Module 15). Known gap: photo location metadata (EXIF) is not stripped (needs an image library). |
| 5 Auctions | **Backend done** (awaiting review) | New `auctions` table (migration `b7e2c4d9a1f3`, up/down/up on `salvex_test_db` only). Approved vehicles only; one open auction per vehicle; sold vehicles cannot be re-auctioned or edited. Admin sets starting price, start/end, late-bid extension ON/OFF + minutes (default 2, provisional); create / edit (price and times only before start) / pause / resume (end moves by paused time) / extend / cancel / close (sold or no_sale), each with reason and audit entry (= history). Phase (upcoming / live / closing / ended) comes from the server clock. Public `/api/auctions?phase=live|upcoming|ended` with server time. Tests: `tests/test_auctions.py` (30). Full suite 420 passed. |
| 6 Bidding | **Backend done** (awaiting review) | New append-only `auction_bids` table (migration `d4a8f1c3e6b2`, trigger rejects UPDATE/DELETE/TRUNCATE; amounts unique per auction; idempotency key unique per bidder). `POST /api/auctions/{id}/bids`: KYC-verified bidders only, not the seller, live auctions only (server clock), first bid >= starting price then any amount above the current bid, current leader cannot bid again; auction row locked per bid; rights/KYC re-read under the lock; late-bid extension when switched on (audit `auction.auto_extend`); `Idempotency-Key` header makes a double click one bid; rate limit 120/min per IP and 30/min per bidder. Public history masked ("Bidder 1"…); `/api/bids/mine`; admin full history. Money always 2 decimals. Tests: `test_bidding.py` (19) + `test_bidding_concurrency.py` (50 simultaneous bids x 3 rounds, and 15 identical clicks = 1 bid; passed 5 runs in a row). Full suite 441 passed. Note: the concurrency test's clean-up switches the bids trigger off and on inside one transaction on the test database only. Proxy bidding not built (company decision pending). |
| 7 Auto-close & winner | **Backend done** (awaiting review) | `app/services/auction_closer.py`: a loop inside the backend (every `AUCTION_CLOSER_INTERVAL_SECONDS`, default 5; off in tests) closes auctions whose end time passed, each in its own transaction with `FOR UPDATE SKIP LOCKED` and a re-check, so two backend processes never close one auction twice; result sold (highest bidder) or no_sale; audit entry as a system action. Paused and extended auctions are left alone. Order creation and winner/seller notifications hook in here in Modules 8 and 12. Tests: `test_auction_closer.py` (5, including 4 closers racing over 20 auctions). Full suite 446 passed. |
| 8 Orders & payments | **Done (bank transfer)** | Migration `e5b9c2d7f1a4`. Order per won auction (`ORD-YYYY-NNNNNN`), amount from the winning bid on the server, deadline `ORDER_PAYMENT_DEADLINE_HOURS` (48, provisional). Winner submits UTR; admin confirms / rejects / cancels (audited). Overdue orders default automatically: bidding blocked `DEFAULT_BIDDING_BLOCK_DAYS` (30), permanent after `PERMANENT_BLOCK_AFTER_DEFAULTS` (2); admin can lift a block. Printable receipt page. Gateway (Razorpay) not built: waiting for the company account. Tests: `test_orders.py`. |
| 9 Invoices | **Partial** | Printable receipt only. GST invoice numbering waits for the company's accountant. |
| 10 Ready to Lift | **Partial** | `/ready-to-lift` (menu item kept, as the client asked) shows the signed-in buyer's PAID orders with the receipt and the collection steps; visitors are asked to sign in. Old demo screens removed (`/payment/*`, `/lifting/*` redirect to the dashboard's Won tab). Affidavit / gate pass / collected status wait for the client's template and rules. |
| 11/13 Spare parts | **Done** | Migration `f6c1a8e3b9d5`. Fixed-price catalogue (admin adds parts with photo, price, stock); public search by make / model / year / part; part requests (`PRQ-YYYY-NNNNNN`) new -> checking -> quoted -> ready -> closed; admins notified, user notified of every update. |
| 12 Notifications | **Done** | Bell + email outbox (sent by the background loop, 3 attempts). Contact page messages (`MSG-YYYY-NNNNNN`, migration `a9e4d2c6b8f1`): public form with rate limit and spam trap, admins notified, admin "Contact messages" tab. Complaints module not built. |
| 14 Reports | **Done** | Dashboard counts; monthly report (payments / vehicles / buyers) with CSV export (see the business model row). |
| 15 Frontend | **Done** | All pages read the real API: catalogue, auctions (live / upcoming / ended), auction page with bidding, bidder dashboard (bids, won + payment, KYC, part requests, profile), seller dashboard, spare parts, contact, notifications bell, full admin console. Demo components and `src/data/mockVehicles.js` deleted; static text moved to `src/data/siteContent.js` and rewritten to the real rules; company contact details come from `VITE_COMPANY_*` (hidden when empty). |
| Auction categories (2026-10-23) | **Done** | Client wants Insurance, Bank / NBFC and Used vehicle auctions listed separately. Vehicle `category` (migration `b3f7a1d9c2e4`, existing rows = used_vehicle); chosen in the vehicle form; `/api/auctions?category=` and `/api/catalogue/vehicles?category=` filters; menu sub-items and category chips on the auctions page; "Used Spare Parts" links to the fixed-price parts page. |
| Verification (2026-10-23) | **Passed** | Backend 480 passed (sequential, `salvex_test_db`); lint 0 errors; build OK; `check:no-demo` PASS; Playwright desktop + mobile pass after updating the specs to the real pages (the fake API in `tests/e2e/helpers/mockApi.js` now answers the data endpoints with empty lists). |
| Client business model (2026-10-25) | **Done** | The client is a middleman; no payment gateway. Six parts, each with backend + browser tests: (1) Buyer ID `SLX-000123` (`users.buyer_number`, admin search by it), deal + service fee recording on results (append-only `fee_payments`, part payments, corrections), Admin > Reports monthly report with CSV export and a 1st-of-month reminder - migration `f1a7c3e9d2b6`; (2) `ONLINE_PAYMENT_FLOW=false`: no UTR / deadline / block / reminders, winner told the team will call; (3) `SELLER_ACCOUNTS=false`: buyer-only registration, no "Sell your vehicle" anywhere on the site (only admins add vehicles; `/sell` goes home); (4) KYC = Aadhaar number (Verhoeff check, last 4 + keyed hash, duplicate flagged) + Aadhaar, PAN, cancelled cheque - migration `a2c8e5f7b1d3`; (5) Ready to Lift rebuilt (supersedes row 10): admin-only listing without auction or price, KM driven + Superdari, "I'm interested" enquiries (`ENQ-YYYY-NNNNNN`) with admin notification and an Enquiries tab, mark sold / show again, highlighted on home + menu - migration `b4d9f2a6c8e1`; (6) bulk upload: Excel (.xlsx, read with the standard library) or CSV, template with Choices + How-to sheets, check-then-import, photos folder matched by registration number, optional auction columns, publish step, and Create auctions for several vehicles (staggered endings). |
| Photos (2026-10-25) | **Done** | Photos shrunk in the browser (1600 px) + 480 px thumbnail for lists (`?size=thumb`); EXIF / XMP / IPTC removed on the server in pure Python (orientation kept) for vehicle and part photos; photo order + cover (`PUT /api/vehicles/{id}/photos/order`) - migration `c6e1f3a8d2b7`; admin "Take photo" opens the phone camera; bulk upload matches photo folders by registration or claim number, asks the default auction category, and lists drafts with a photo box each. Client usage guide: `docs/ADMIN_GUIDE.md` (Malayalam). Pillow was not installed (not approved by the auto-mode policy); not needed for this design. |
| After-auction flow (2026-10-25) | **Done** | A vehicle sold in an auction leaves the public lists (an old link shows "Sold"); a cancelled sale makes it available again. The "Vehicles" menu item / all-vehicles page was removed (every vehicle is in an auction or Ready to Lift); `/vehicles` redirects to the live auctions; vehicle detail pages stay. |
| Simple enquiries (2026-10-26) | **Done** | Admin sidebar in groups (Enquiries / Vehicles & auctions / Buyers / More) with "new" counts; Vehicle enquiries and Spare part enquiries are separate sections. Spare part requests now work like the Ready to Lift enquiries: the customer must leave a phone number, admins are notified and call; statuses new / contacted / closed with an internal note; no price, reply or messages to the customer; users can no longer cancel (migration `d7f2b4c9e1a3`). |
| Admin vehicle sections (2026-10-26) | **Done** | "Vehicles" replaced by **Ready to Lift** (own section: Available / Sold / Drafts, Add vehicle, Bulk upload) and one simple **Auctions** list with tabs Waiting (vehicles without an auction: Start auction / Start several together; Need photos) / Upcoming / Live / Ended (`GET /api/admin/auctions?view=`), Bulk upload and New auction in its header. The Listing field is gone from the vehicle form: the section decides it (bulk upload `listing=` default for rows without a Listing). Add vehicle shows step boxes (Vehicle details > Photos). |
| Admin search (2026-10-26) | **Done** | Search box on every admin screen (`GET /api/admin/search`): Buyer ID / name / phone / email finds people, registration / claim number / make / model finds vehicles. Overviews: `GET /api/admin/users/{id}/overview` (contact, KYC, bids, auctions won with deal and fee, vehicle and part enquiries) and `GET /api/admin/vehicles/{id}/overview` (details, photos, every auction with winner and fee, enquiries), linked to each other and to Results / Auctions / Enquiries. |
| Audit fixes (2026-10-27) | **Done** | Vehicle photos have their own upload limit (3000 / 10 min per IP; KYC keeps 60); deal **Mark completed** / **Cancel sale** on Results (`POST /api/admin/orders/{id}/complete`, cancel frees the vehicle for a new auction); admin lists use the chosen cover; deal state in the search overviews; Waiting count includes drafts; buyer "Won auctions" text without payment; calendar keeps Ends after Starts and never in the past; crop resets on resize; locked vehicles (auction / sold) cannot change photos; a published vehicle keeps its last photo; the interest window locks page scroll. |
| 16 Deployment | **Prepared** | `backend/Dockerfile`, root `Dockerfile` + `deploy/nginx.conf.template` (one domain, `/api` forwarded), `vercel.json` rewrite, env examples, `docs/HANDOVER.md`. Not deployed: waiting for Coolify access and domain. |

### Module 2 details

Endpoints (all under the admin-only router; writes also need the CSRF token for cookie sessions):

* `GET /api/admin/users` - paginated search, newest first. Filters (AND): `q` (name, email or phone),
  `name`, `email`, `phone` (formatting such as spaces, dashes and brackets ignored), `role`, `kyc_status`,
  `status` (`active`/`suspended`), `is_email_verified`. `%` and `_` are matched literally.
* `GET /api/admin/users/{id}` - detail including the suspension record and active-session count.
* `POST /api/admin/users/{id}/suspend` - reason required (3-500 chars). Sets `is_active=false` and the
  suspension fields, revokes every session, audit `user.suspend`.
* `POST /api/admin/users/{id}/reactivate` - optional reason. Clears the suspension record; old sessions stay
  revoked (the user signs in again). Audit `user.reactivate`.
* `POST /api/admin/users/{id}/role` - `bidder` <-> `seller` only, reason required. Revokes every session of
  the target. Audit `user.role_change` with old and new role. Demoting another admin is allowed.
* `GET /api/users/me`, `PATCH /api/users/me` - a user may change only `name`, `mobile`, `organization`; any
  other field (role, status, KYC, email, ...) is rejected with 422.

Safety rules: an admin cannot suspend, reactivate or change the role of their own account; granting
`admin` is impossible through the API (still only `python -m app.cli create-admin` on the server). Every
account action first locks the target, the acting admin and all active admins in one statement in id
order, then re-checks under the lock that the actor is still an active admin (refused with 403 if they
were suspended or demoted while the request waited) and that the last active admin is not being removed
(409). Each action, its session revocation and its audit row are committed in one transaction (a test
forces the audit write to fail and checks that nothing else was saved).

Code: `backend/app/api/admin.py`, `backend/app/api/users.py`, `backend/app/services/user_management.py`,
`backend/app/schemas/admin.py`, `backend/app/schemas/users.py`. Tests: `backend/tests/test_users_admin.py`,
`backend/tests/test_users_admin_concurrency.py`, and the role guard in `backend/tests/test_authorization.py`.

**Blocked - buyer ID:** no buyer ID field or format exists in the code or in any requirement found in the
repository (see section 6). Not implemented and not searchable until the company defines the format.

Not in scope here: the admin UI in `src/components/AdminPanel.jsx` is not yet wired to these endpoints
(Module 15); profile edits by users are not audit-logged (not an admin action).

### Module 2 review (2026-10-22)

| Area | Finding | Result |
|---|---|---|
| Admin role escalation | Only three code paths write a role: registration (schema + `PUBLIC_ROLES` check), the admin role change (schema + service check), and the server-only `create-admin` CLI. No client request can grant `admin`. | No defect. The guard test was rewritten to walk every request body (all content types, nested models, $refs) and every parameter of every write route, and a meta-test proves it flags unsafe routes. Behavioural tests try each client path. |
| Last-admin locking | **Defect:** the target row was locked before the admin set, so two admins acting on each other at once **deadlocked**; one request crashed with a 500 (reproduced 9/9 runs). No admin was ever lost, but the response was uncontrolled. Also the actor was not re-checked under lock. | **Fixed** (single ordered lock + actor re-check). New `tests/test_users_admin_concurrency.py`: 3 scenarios x 8 rounds of real simultaneous commits; passed 5 consecutive runs with exactly one winner, a clean 401/403 for the other, one admin left. |
| Session revocation | Suspension and role change revoke all of the target's sessions only; reactivation does not revive them. | No defect; regression test added. The admin detail's `active_session_count` counted idle-timed-out sessions; **fixed**. |
| CSRF | All admin writes and `PATCH /api/users/me` require the token for cookie sessions; bearer clients are exempt by design. | No defect. |
| Audit transactions | Change, revocation and audit row share one commit; a forced audit failure saves nothing. | No defect. |

Remaining risks: the concurrency test replaces the audit writer with an in-memory recorder, because
committed audit rows are append-only and would block deleting the test users (same-transaction auditing is
proven in the rollback-based tests). The last-admin check counts every active admin in the database, so the
race test requires `salvex_test_db` to contain no committed admins (it asserts this). The `python-multipart`
package is not installed, so the app cannot accept form bodies; the role guard would still inspect them.

### Module 3 details (KYC)

Workflow (`backend/app/services/kyc.py`): a bidder or seller starts a **draft**, uploads documents, and
**submits**. An admin then **approves** (account `kyc_status` = `verified`), **rejects** (`rejected`) or
**requests changes** (`changes_requested`; the user may add/withdraw documents and resubmit). Every
decision needs a reason and is stored in `kyc_decisions` with reviewer and time; that table is append-only
(database trigger). One open submission per user (partial unique index). Status changes, uploads,
withdrawals and admin document views are audit-logged in the same transaction; audit details hold
metadata only (type, size, ids, reason), never file contents, names or storage keys.

Endpoints: `GET /api/kyc/me`; `POST /api/kyc/submissions`; `POST /api/kyc/submissions/{id}/documents`
(raw file body, see below); `DELETE /api/kyc/documents/{id}` (withdraw, file kept);
`POST /api/kyc/submissions/{id}/submit`; `GET /api/kyc/documents/{id}/file` (owner or admin only, others get
404; always an attachment with `nosniff`, `no-store` and a sandbox CSP); admin: `GET /api/admin/kyc/submissions`
(queue, oldest first), `GET /api/admin/kyc/submissions/{id}`, `POST /api/admin/kyc/submissions/{id}/decision`.
`require_verified_kyc` (in `app/api/deps.py`) is ready for Module 6; it reads the status from the database.

Files: accepted PDF, JPEG, PNG, identified from the bytes (the declared type must match). Refused: other
types, empty, damaged/truncated files, PDFs declaring scripts/actions/attachments/forms, over
`KYC_MAX_FILE_BYTES` (default 5 MB, enforced while the body streams in), more than
`KYC_MAX_DOCUMENTS_PER_SUBMISSION` (default 10) active documents. Storage is behind an adapter
(`app/services/storage.py`); the local-disk adapter writes to `KYC_STORAGE_DIR` (default
`backend/.private_storage/`, git-ignored) under random keys. Nothing is reachable by a public URL.

**Upload format and `python-multipart`:** uploads send the file as the raw request body
(`Content-Type: application/pdf` etc.). FastAPI only needs `python-multipart` for HTML-form
(`multipart/form-data`) bodies, so **no new dependency is required**. If the company prefers form uploads,
the proposal is `python-multipart>=0.0.18,<0.1` (0.0.18 fixes the CVE-2024-53981 parsing DoS); not
installed without approval.

Tests: `backend/tests/test_kyc.py` (46 tests). Full backend suite: 342 passed, sequentially, on `salvex_test_db`.

Provisional defaults (to be confirmed by the company, not invented business rules):
* Generic document types `identity_proof`, `address_proof`, `business_proof`, `other`; submission needs at
  least one document. No specific document (PAN, Aadhaar, PCC, GSTIN...) is required or named.
* After a rejection the user may start a new submission; after approval they may not. Bidders and sellers
  may apply; admins may not, and nobody can review their own submission.
* The 5 MB / 10 documents limits are technical safety limits.

**Blocked on company decisions** (see section 6): the required document list per role; retention and deletion
of documents (nothing is deleted today - withdrawn files are kept); malware scanning (the PDF check is
structural only, not a virus scan); production storage provider, encryption at rest and backups (local
disk is for development/staging only); whether approval can later be revoked (no revoke action exists);
whether to verify ID numbers with a third-party provider (no ID numbers are stored).

Known gaps: no live two-admin race test for decisions (rows in `kyc_decisions` are append-only and cannot be
cleaned out of the shared test database; the decision path uses a row lock and a status re-check, and a
test proves a reviewer who lost admin rights mid-request is refused); the admin and dashboard UIs are not
connected yet (Module 15); user-facing notifications of decisions belong to Module 12.

### Before running the website locally (Modules 1 and 3)

The local development database must be migrated once (`alembic upgrade head` from `backend/`, with
`DATABASE_URL` pointing at the local development database) or sign-in and KYC will fail. Pending revisions:
`a4d81c6e5b20` (audit log, suspension columns) and `5c3e9a7b1f42` (KYC tables). Both only add tables or
nullable columns. This is deliberately left as an explicit, separate step that needs approval.
