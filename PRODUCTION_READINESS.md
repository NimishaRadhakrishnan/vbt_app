# Production readiness — 29 September 2026

What was verified, what was fixed, and what is still open. Written after
standing the whole stack up (PostgreSQL 16 + PostGIS, Redis, FastAPI, Next.js),
running every migration on an empty database, seeding it, running the test
suite, and driving the admin portal in a real browser.

Nothing below is inferred from reading code. Where a claim is made, it was
executed.

---

## Verified state

| Check | Result |
| --- | --- |
| Migrations on an empty database | 64 migrations, clean, 100 tables |
| Backend test suite | **228 passed, 1 skipped** (stable across repeated runs, randomised order) |
| Frontend unit tests | 18 passed |
| TypeScript | `tsc --noEmit` clean |
| Frontend production build | clean, 14 routes |
| Tiered pricing, in a browser | bands created, overlap refused with a readable message, dealer band accepted alongside the general one, bulk sheet rejected whole on one bad row |
| Management dashboard, in a browser | all eight questions answered on screen, charts render, officer drill-down complete, no sideways scroll at 1440/1280/1024px |
| Every admin page loaded in a browser | no 5xx, no uncaught page errors |
| Login throttling, in a browser | 6 wrong passwords throttle; another account on the same IP still signs in; 6 correct sign-ins in a row all succeed |
| CORS | an unlisted origin is refused in both development and production |
| Production config guard | refuses to boot on unsafe settings, allows a correct one |
| Stock loop end to end over HTTP | issue 50 → give 5 → reads 45; overdraw of 999 refused, balance unchanged |
| Demo seed re-run three times | repeatable, config preserved |

The one skip is `test_working_hours_logout.py`, which is only meaningful after
working hours on a working day. It skips by design, not by failure.

---

## Defects found and fixed

### 1. Deleting a farmer or dealer returned 500

`visits.farmer_id` had `ON DELETE SET NULL` while `check_visit_target` required
it to be non-null. The two constraints contradicted each other, so deleting any
farmer who had ever been visited raised `CheckViolation` and the request died
with a 500. The delete could never have succeeded.

Fixed in `202609290001_visit_target_fk_restrict.py` — the foreign keys are now
`RESTRICT`, matching the policy already applied to the other history tables.
`DELETE /farmers/{id}` was also rewritten: it checked nothing, deleted
unconditionally, logged nothing, and returned `{"status": "success"}` for a
farmer that did not exist. It now archives a farmer who has visits, hard-deletes
one who does not, 404s on a missing id, and writes an audit entry either way.

Covered by `tests/integration/test_farmer_delete.py` (3 tests).

### 2. `GET /attendance/roster-status` returned 500 on every call

The fix for the UTC day-boundary bug added, *inside the function body*:

```python
from app.domain.services.time_utils import company_today, company_tz
```

That module does not exist. Because the import was nested in the function, it
only failed when a request arrived — so it passed every import-time check and
the whole test suite. In the browser it surfaced as a CORS error, because the
500 response carried no CORS headers, which hid the real cause. `timedelta` was
never imported either.

Fixed, and guarded: `test_dashboard_endpoints_smoke.py` now resolves every
import target in every router and fails on one that points at nothing. The
guard was verified by reintroducing the exact bug (it failed) and removing it
again (it passed).

### 3. Refreshing any page logged the admin out

`GET /auth/me` answered a missing token with **403**. FastAPI's
`HTTPBearer(auto_error=True)` does that by default. The web client only attempts
a silent token refresh on **401**, so after any page reload the refresh never
fired and the user was bounced to the login screen. Bookmarks and deep links
never worked.

`get_current_user` now raises 401 itself. 403 stays reserved for "authenticated
but not permitted". Verified in a real browser: reload now keeps the session.
Covered in `test_auth_flow.py`.

### 4. An invalid `visit_purpose` returned 500

The API schema did not constrain the field, so an unexpected value reached
Postgres and tripped `ck_visit_trial_purpose`. Officers saw a bare 500. The
schema now mirrors the constraint and returns a 422 naming the allowed values.
`trial_plot_size_cents` was `ge=0` against a database constraint of `> 0`; also
corrected.

Note: `test_stock_http.py::test_trial_rejected_when_insufficient` had been
passing on a coincidence — its payload carried an invalid `visit_purpose`, and
the stock check happened to answer 400 before the row reached the database. Its
payload is now valid, so it tests what its name says.

### 5. The login screen rejected correct passwords

"Select Your Role" defaulted to Field Officer. An admin entering the right
credentials was logged in, the app then compared the account's real role to the
dropdown, logged them straight back out, and showed *"This account is registered
as a Admin."* The dropdown gated nothing — roles are enforced server-side — and
could only ever cost a login. Removed.

### 6. Seven tables from a different product

This repository was scaffolded from the **MCP Server Risk Scanner** project and
its migrations came along: `mcp_servers`, `tool_capabilities`, `risk_findings`,
`risk_cards`, `governance_recommendations`, `alerts`, `connections`, `policies`.
No file under `app/` referenced any of them. `marketing_materials` and
`marketing_categories` were also still present after the Marketing module was
cut. All ten dropped in `202609290002_drop_unused_scaffold_tables.py`.

The app also identified itself as `APP_NAME="MCP Server Risk Scanner"`, and the
browser stored its session under `mcp_scanner_refresh_token`. Both renamed.

### 7. The demo seed could only ever run once

It cleared tables from a hand-written list, so the first table it missed
(`kudos`) made `DELETE FROM users` fail on a foreign key and rolled the whole
seed back. It now asks `pg_constraint` which tables actually block a delete and
clears those, leaving the day-closure form configuration that migrations own
intact. Verified by running it three times in a row.

### 8. Smaller fixes

- An over-broad test fixture ran `DELETE FROM farmers WHERE name = 'Test Farmer'`
  across all modules, taking eight unrelated tests down with it. Scoped to its
  own rows.
- `test_visit_count_0030_ist.py` pointed at `/api/v1/daily-visit-tracker/...`;
  the real route is `/api/v1/visits/daily-tracker/...`. It had been left failing
  with a 404. The underlying IST logic was correct.
- `bcrypt` pinned to 4.0.1 — passlib 1.7.4 reads `bcrypt.__about__`, which
  bcrypt ≥ 4.1 removed, and logged a trapped stack trace on every password hash.
- Off-brand indigo primary button and tab on the Stock page, and an off-brand
  blue submit on Field Network, changed to the maroon brand colour. Indigo
  elsewhere is a deliberate accent on the Momentum/Kudos components and was left.
- Missing `alt` on visit photos.
- `autoComplete="off"` on the login fields replaced with `username` /
  `current-password`, so password managers and phone keyboards behave.
- Roughly 50 `patch_*.py` scratch files, ad-hoc `test_repro*.py` debug scripts,
  a committed `.venv`, a committed `.next` build, and `tsconfig.tsbuildinfo`
  removed; `.gitignore` extended so they do not come back. The tree went from
  895 MB to about 5 MB excluding `node_modules`.

---

### 13. Sixteen business rules reached the user as server crashes

`raise ValueError("You have already checked in for today.")` — and fifteen
more like it across the application layer. No handler mapped `ValueError`, so
every one of them fell through to the catch-all and the officer was shown *"An
unexpected error occurred. Our team has been notified."*

The messages were already written for a person. None of them ever arrived. An
officer who taps check-in twice, or whose first request succeeded while the
reply was lost on a rural connection, saw a crash instead of an explanation.
The same held for "Weekly plan … cannot be modified", "A farmer with phone
number … is already registered", "You must complete your active visit session
before starting a new one".

Found by driving the real UI, not by reading code: the check-in call returned
500 and the log showed a perfectly good message behind it.

`BusinessRuleViolationException` and `ConflictException` were added to the
existing domain hierarchy and all sixteen sites converted — 409 where the
request would duplicate something, 400 otherwise. A source guard fails the
build if a bare `ValueError` reappears in the application layer.

**Evidence:** duplicate check-in now returns `409 {"message": "You have already
checked in for today."}` · `test_business_rules_reach_the_user.py`

### 14. The Stock History screen was permanently blank

`GET /stock/ledger` with no `officer_id` fell back to `current_user.user_id`.
Admins hold no stock, so an admin asking for the whole movement history was
silently asking for their own, and always got an empty list. The Stock History
tab calls it exactly that way, so the movement audit trail — the thing that
makes the append-only ledger worth having — could not be reached from the UI at
all.

The docstring said "admin/manager see anyone's". The code never did.

Now: an officer sees their own, an admin or manager sees a named officer's or,
with no filter, everyone's. Widening the admin case did not widen the officer
case — an officer passing another officer's id still gets only their own.

**Evidence:** History now lists the +50 allocation and the −5 trial with the
officer's name · two tests in `test_stock_walkthrough.py`, both confirmed to
fail when the old line is restored


## Login and secrets — done

### 9. Brute-force protection was off, in code, not just in the env file

`Settings` declared `login_rate_limit_attempts = 5000` and
`login_rate_limit_window_seconds = 1`. That is not a limit; it is the limiter
switched off, and it applied **even with no `.env` present**, so a clean
deployment inherited it.

Tightening the numbers alone would have made things worse. The counter was
keyed on **client IP**, and officers reach the API over mobile networks that
NAT a whole region behind a handful of addresses — a five-attempt IP limit
would have let one officer's typo lock out every colleague on the same carrier.
It was also too weak in the other direction: an attacker guessing one officer's
password simply rotates source addresses and gets a fresh allowance each time.

Now:

- **Only failed sign-ins count.** The dependency in front of `/auth/login`
  reads the counters; the increment happens on the failure path in the
  handler. A correct password costs nothing and clears the account's counter.
- **Per account: 5 failures per 5 minutes.** This is the actual guard, keyed on
  the identifier being attempted.
- **Per source address: 100 failures per 5 minutes.** A backstop for one host
  trying a password against many different accounts, which the per-account
  limit cannot see.
- **Redis unreachable fails open.** A rate limiter that cannot reach its store
  must not lock out the whole field force; passwords remain the barrier.

*A wrong first attempt at this, recorded because it is the useful part:* the
first version counted **every** attempt against a 50-per-5-minutes IP bucket.
It passed in isolation, then failed when the packaged build was re-verified
from scratch — a run of ordinary sign-ins exhausted the bucket and cascaded
into 17 failures. In the field that is a district of officers behind one
carrier NAT at nine in the morning, which is the exact problem the per-account
key was introduced to avoid. `test_a_busy_shared_address_is_never_throttled`
now covers it, and was confirmed to fail when the old behaviour is put back.

Verified in a browser: six wrong passwords throttle with a readable message; a
different account from the same address still signs in; six consecutive correct
sign-ins all succeed.

### 10. The CORS allowlist did nothing

```python
allow_origins=settings.cors_allowed_origins,
allow_origin_regex="https?://.*",     # matches every origin there is
allow_credentials=True,
```

Starlette ORs the regex with the allowlist, so the allowlist was decorative and
any site a signed-in admin visited could call this API with their session. The
regex is gone. Outside production a narrow `localhost`/`127.0.0.1` pattern
remains so dev servers on arbitrary ports still work.

### 11. Secrets regenerated

- `backend/.env` has a freshly generated `JWT_SECRET_KEY` and the corrected
  login limits. The key that was committed to this repository's history is no
  longer in use.
- `backend/.env.production.example` is filled in and ready: `ENVIRONMENT=production`,
  `DEBUG=false`, correct limits, a separate freshly generated JWT key and a
  generated Postgres password. **Set `CORS_ALLOWED_ORIGINS` to the real portal
  domain before deploying** — it still points at localhost.

Because those keys travelled through a chat and a zip, regenerate on the server
if you want one that has never left the machine:

```bash
openssl rand -hex 32
```

Rotating the JWT key signs out every existing session. Harmless before launch;
worth knowing afterwards.

### 12. A startup guard, so this cannot regress quietly

`app/main.py` now refuses to start when `ENVIRONMENT=production` and any of
these is true: `DEBUG=true`; the JWT key is a known example value or shorter
than 32 characters; the login limit is above 10 attempts or the window under
60 seconds; `CORS_ALLOWED_ORIGINS` contains a wildcard. It fails loudly at boot
with the specific reasons listed.

Development is never blocked. Every one of these values was live in the shipped
`.env` at least once, and none of them break anything visibly — the app starts,
the login page loads, and the weakness is invisible until it is exploited. Boot
is the only moment it reliably gets noticed.

`/docs` and SQL echo were already correctly gated in code; only the env file had
been wrong.

---

## CRUD coverage

227 registered API routes. Every business entity has create, read, update and
delete reachable from the admin portal, with these deliberate exceptions:

| Table | Missing | Why it should stay missing |
| --- | --- | --- |
| `stock_ledger` | update, delete | Append-only by design. A balance is `SUM(qty_delta)`; a correction is a compensating row, so drift is not representable. |
| `audit_logs` | update, delete | An audit trail an admin can edit is not an audit trail. |
| `gps_tracks` | update, delete | Location history is evidence. The retention job deletes it on a schedule; nothing edits it. |
| `attendance` | update, delete | Check-in and check-out are events, not editable records. |

---

## Tiered pricing, and bulk entry

A product had exactly one price, so a dealer buying 500 units was charged the
same rate as one buying 2, and any discount an officer promised in the field
had to be typed in by hand or not at all.

**How a price is decided now** — most specific wins:

1. a band set for *this dealer* that covers the quantity
2. a general band (any dealer) that covers the quantity
3. `products.price`, the list price

Step 3 is why this changed nothing for existing data: a product with no bands
prices exactly as before. Verified by `test_a_product_with_no_tiers_prices_exactly_as_before`.

**Overlapping bands are refused by the database, not by code.** If `1–10` and
`5–20` both existed, the price of 7 units would depend on which row a query
reached first, and the same order could be billed two ways. Migration
`202609300001` makes that state unrepresentable with an `EXCLUDE USING gist`
constraint. The application checks for overlaps too, but only so it can name
the band in the way — two admins saving a moment apart both pass that check,
and the second is stopped by the constraint.

**Quantities are totalled per product before pricing.** Two lines of 5 is an
order for 10 and is priced at 10. Pricing each line separately would withhold
the discount the order earned, and the dealer would be the one to notice.

**Bulk entry is two sheets, not one.** Products first, price bands second: the
catalog is set up once, the price sheet is revised whenever rates move, and a
combined sheet would mean retyping every product's details to change one rate.
Both sheets are **all-or-nothing** with a **check-without-saving** preview.
Half an applied price sheet is worse than none — nobody can tell which products
are now wrong, and the dealer finds out first.

### Two bugs worth recording

**The first version of the migration could not store the most common band.**
It built the range as `int4range(min, COALESCE(max, 2147483647), '[]')`.
Postgres normalises an inclusive upper bound to `max + 1`, so the sentinel
became 2147483648 and every open-ended band — "51 and above" — was rejected
with `integer out of range`. It was found by testing the constraint against a
real database rather than reading the DDL, and in the first test run the
failure was disguised: because the open-ended insert failed, the *next* case
was accepted when it should have been refused, and the sequence looked
coherent. `test_an_open_ended_band_can_actually_be_created` now fails if the
old form is restored; that was checked by restoring it.

**A refusal from the database reached the user as a 500.** No handler mapped
`IntegrityError`, so any constraint the application had not pre-checked
produced "An unexpected error occurred" — the same failure the sixteen bare
`ValueError`s used to cause. `error_handler.py` now maps constraint names to
409 or 400 with a message a person can act on, and never returns the driver's
own text, which names tables and columns and quotes the conflicting value
(on some tables, a phone number).

### One UI issue this surfaced

In `tailwind.config.js`, `green` is **maroon** — a legacy name from an earlier
reskin, documented in that file. So `bg-green-50` with `text-green-800`, the
usual way to write a success banner, comes out the same pink as
`bg-red-50`/`text-red-700`. An operator pasting a price sheet could not tell
saved from rejected at a glance. A real `success-*` palette was added and used
for the confirmation banner.

**The same confusion exists elsewhere and was left alone**: the "Active" status
badge uses `bg-green-100 text-green-700` and renders pink, which reads as a
warning when it means healthy. Changing it is a one-line fix per site, but it
is a visual decision across the app and it is yours to make.

---

## Management dashboard (Momentum & Milestones, admin and manager)

A business control panel for the owner: total sales, growth, who is selling,
what is selling, where, what is seasonal, who needs attention, and whether
field work is producing business. Every figure ships with a plain sentence
generated next to the query that produced it, so the words and the number
cannot drift apart.

It sits in the **Momentum & Milestones** tab. Officers still see their own
motivational view — that code says *"personal trend only, never a ranking"*
and it still means it. Admin and manager see the ranked business view instead.
The two readers want opposite things from the same month, so they get
different screens rather than one screen that serves neither.

### What was missing from the database, and what was done

The brief said not to invent profit or sales data, and to identify what is
missing. Three things were:

| Missing | Effect | What was done |
| --- | --- | --- |
| **Cost of a product.** `products` had `price` and no cost anywhere in the codebase — the only matches for "margin" were PDF page margins. | Profit was not computable at all. | `products.cost_price` added, **nullable**. Contribution is reported only for products that have one, and the card states what share of revenue it could assess. A product with no cost is excluded, never treated as costing zero. |
| **Price on a field sale.** `visit_sale_items` stored product, quantity and unit — no price. `visit_sales.order_value` is one total per visit that cannot be split across its products. | Officer field sales contributed units but no money. Revenue was dealer-orders-only, so the field force was invisible in every rupee figure. | `unit_price` and `line_total` added, nullable. New rows are priced through the same band resolver a dealer order uses. Rows written before the migration keep a NULL price and are counted as quantity, with the dashboard saying so. |
| **Sales-value targets.** Only `momentum_targets` existed — a monthly *task count* per role, not money. | "Target vs achievement" had nothing to measure against. | No schema change needed: `officer_monthly_targets` is (officer, period, metric, target_value) with a free-text metric, so a target is a row with `metric='sales_value'`. |

**Nothing was back-filled.** Existing field-sale rows keep a NULL price rather
than being valued at today's list price, which would be inventing history.

### Still to be entered by you

- **Cost price for each product**, on the Products page. Until then the profit
  card says it cannot be shown and names how many products are missing a cost.
  It never shows a zero.
- **Monthly sales targets per officer**, as `sales_value` rows. Without them
  the target bar says "no target set" and the final milestone stage explains
  that it cannot be reached — it does not show as a failure.

### What the dashboard refuses to claim

- **Seasonality below twelve months of history.** With three months, "sells
  more in June" is the shape of whatever happened to be recorded. The panel
  says how much history exists and how much is needed.
- **A conversion-rate verdict below ten visits.** 0% off three visits is
  arithmetic, not evidence.
- **Growth against a zero month.** The first month of anything is not "up
  100%" — that is a fact about division. It reports "nothing to compare
  against yet".
- **Profit where cost is unknown.** Covered above, and the one that would have
  flattered the business — the direction nobody checks.

### Demo data

`scripts/demo_seed.py` now loads **15 months of order history** with a real
seasonal shape (Bio-NPK peaks in the kharif window, Trichoderma after the
north-east monsoon, Pseudomonas deliberately flat so the detector has
something it should *not* flag). It is demonstration data, in the seed only,
never in a migration. Two of the three products get a cost and the third
deliberately does not, so the "cannot show profit" path is visible in the demo
rather than only in a test.

### One thing found by looking at the real screen

The **Needs attention** list was initially swamped: every dormant account
raised its own warning, and the officers who were genuinely struggling were
buried among accounts nobody expects anything from. A list that is always full
teaches the reader to skip it as surely as one that is always empty. Officers
with no visits *and* no sales are now counted in a single line and collapsed
into their own group — still on the page, still countable, no longer competing
for the attention of someone reading for thirty seconds. That change removed
about 2,100px from the page.

---

## Still open

Nothing here blocks a submission, but none of it should be described as done.

**Design decisions I did not make for you.**

- Sub-pages lose the navigation. The Overview page has the maroon header and
  the left sidebar; Field Network has neither; Products has a dark navy header
  instead. Three different page chromes. It is the most visible inconsistency
  in the product and it needs one decision, applied everywhere.
- On a 1440px screen the Overview content column stops at about 770px, leaving
  a wide empty band on the right. Other pages run full width.
- On Field Network, **Delete is the only action on a farmer card**, and its red
  tint makes it the most prominent thing on the row. There is no view or edit.

**Not done.**

- `frontend/app/dashboard/page.tsx` is 5,096 lines. It builds and works, but
  every change to it is riskier than it needs to be.
- Frontend test coverage is thin: 18 unit tests, covering the officer-status
  helper and the CSV reader behind bulk import. There is nothing that renders
  a component. The price-band and bulk-import screens were verified by driving
  a real browser against a real database, which is stronger than a unit test
  for what it covers and covers nothing else.
- The login page links to `/forgot-password`, which does not exist — the link
  404s. Pre-existing; found while driving the browser.
- The mobile app was not built or run here — there is no Android toolchain in
  this environment. Its code was not changed.
- **Admin password viewing was never implemented.** You asked for it; it was
  scoped as a bcrypt hash plus an AES-256-GCM vault with the key held outside
  the database, and it stopped there. Existing passwords are bcrypt-hashed and
  are not recoverable by anyone, including you. Nothing in the app shows a
  password today.

**Play Store, from the compliance work.**

- 60–90 second demo video on an API-34 build, showing the disclosure before the
  OS permission prompt.
- Background-location and precise-location declarations.
- A permanent reviewer test account.
- Store description and privacy policy URL.
- Managed Google Play private distribution.

The GPS retention job is scheduled — the `scheduler` service in
`docker-compose.yml` runs it daily at 02:00 IST.

---

## Running it yourself

```bash
docker compose up -d postgres redis
docker compose up -d --build backend frontend scheduler
docker compose exec backend alembic upgrade head
docker compose exec backend python scripts/demo_seed.py
docker compose exec backend python -m pytest tests/ -q
```

See `DEMO.md` for the walkthrough.

---

## Deployment checklist

On the server, before the first real user signs in:

1. `cp backend/.env.production.example backend/.env`
2. Set `CORS_ALLOWED_ORIGINS` to the real portal domain. It still says
   `http://localhost:3000`, and this is the one value that is certainly wrong.
3. Set the same `POSTGRES_PASSWORD` on the database service.
4. Optionally regenerate the JWT key and the database password with
   `openssl rand -hex 32` so neither has ever left the server.
5. Set `REDIS_PASSWORD` and keep Redis off the public network — it holds live
   officer positions and refresh-token state.
6. `docker compose up -d --build`. **If the backend refuses to start, read the
   error**: the startup guard lists exactly which settings it objected to. That
   is the guard working, not a failure to deploy.
7. `docker compose exec backend alembic upgrade head`
8. Create the real admin account and **change every seeded password**. The demo
   accounts and their shared password are published in `DEMO.md`; do not carry
   them into production.
