# VBT One — Phase Status

Last updated: 15 September 2026

**Read this first: the app is not ready to publish.** Real, verified work
was completed; a substantial amount was not. This file separates the two
honestly so you can plan against it rather than discover the gap later.

---

## How the verification was done

A throwaway environment was built to make the claims below checkable
rather than assertable:

- PostgreSQL 16 + PostGIS 3 + Redis, running the real schema
- All 26 Alembic migrations applied from scratch
- `scripts/demo_seed.py` run, so integration tests hit realistic data
- Full pytest suite run before and after every change

**Test count: 108 passing at baseline → 139 passing, 0 failing.**
Migrations verified reversible (`downgrade` → `upgrade` round-trip).
`ruff` clean on every file authored or modified here.

Anything below marked DONE was observed working. Anything marked NOT DONE
was not started or not finished, and is not partially hidden somewhere.

---

## DONE — verified

### 1. Stock ledger (your "trial must subtract automatically")

The defect was two routers answering "how much stock does this officer
have?" with different formulas over the same table:

| | old `trial_router` | old `sales_stock_router` |
|---|---|---|
| Source | `opening + received − SUM(trials)` | `current_quantity`, officer-editable |
| On a trial | went down | **unchanged** |

And separately: **nothing in the entire backend ever wrote
`opening_stock` or `received_stock`.** They were read in three places and
written in none, so every officer's remaining was 0 and trials were
blocked for everyone.

**Now:** one append-only `stock_ledger`. Current stock is always
`SUM(qty_delta)` — never stored, so there is no second number to drift
from. A trial writes its deduction **in the same transaction as the
visit**, so there is no code path where a trial is recorded without the
stock movement.

- `stock_ledger` migration `202608260026`, with backfill from both legacy
  systems (allocation → trials → reconciliation to any physical count)
- `stock_router.py` replaces both deleted routers
- `POST /stock/allocations` — **the endpoint that did not exist.** Admin
  issues stock; accepts a batch, so bulk upload is the same endpoint
- `GET /stock/reconciliation` — allocated vs given vs sold vs on-hand
- Sign discipline enforced by DB CHECK constraints, not just Python, so
  any future migration or script is caught too
- **8 tests passing**, two of which fail on the old code

**Bonus finding:** there was a **third** trial path. `farmer_router`
recorded farmer-registration trials into `farmer_trial_products` and
deducted nothing anywhere. Now ledgered, with compensating-row reversal
when a farmer's trial details are edited.

### 2. Location day-boundary bug

`location_router` grouped history by `DATE(recorded_at AT TIME ZONE
'UTC')`. Officers are IST (UTC+5:30), so **every ping between 00:00 and
05:30 IST landed on the previous day** — routes silently split across two
dates, points missing from the day being viewed.

The codebase already had `company_time.py`, whose docstring says every
"which day is this?" decision must use company time. This file ignored it.

Also fixed: the predicate was non-sargable, so the existing
`(user_id, recorded_at)` index could not be used and every lookup
scanned. At one ping / 15s that is ~500k rows/month for ten officers.

**A source-guard test caught a third occurrence I had missed**, in the
diagnostics endpoint — which mattered specifically because that endpoint
compares ping count against check-in duration, so it reported a wrong
delivery rate for any early-starting officer. "Tracking looks unreliable"
is exactly the conclusion that endpoint exists to test.

**6 tests passing**, including one that demonstrates the old predicate
losing the ping on the same data, so the fix is provably real.

### 3. Location consent (Phase 3a backend)

- `202608260025` — disclosure versions + append-only acceptance log
- Disclosure **text lives in the DB**, so the acceptance record says what
  the officer actually agreed to, and wording can change without a new
  build during Play review
- Partial unique index: exactly one active disclosure, enforced by the DB
- `require_location_consent` gates **check-in only**. Check-out is never
  gated — an officer already being tracked must always be able to stop
- **Admin exempt**, so admin flows don't break
- `GET /admin/consent/location` — LEFT JOIN from users, so officers who
  have *not* accepted appear as rows. The non-acceptances are the
  important half
- Tests: guard blocks, guard allows after accept, one-active enforced,
  all five required disclosure points present, log append-only

### 4. Knowledge auto-feed (your decision: keep + auto-populate)

`promote-issue` already existed but was manual. Now `POST
/crop-issues/{id}/resolve` creates the knowledge case in the same
transaction.

The existing code's caution was kept, because it was right: a reply
reading "spray as we discussed" published verbatim actively misleads the
next officer. So — substantive replies publish immediately and are
searchable that minute; short or personal-reference replies queue for
review **with the reason attached**, one click from publishing. Default
is on; the expert can supply a rewritten reusable version, which skips
the heuristic.

Wrapped so it can never fail the resolution: the farmer's issue being
resolved is what that endpoint is *for*.

**11 tests passing**, including word-boundary checks (so "recall" doesn't
trip "call me") and a test that a DB failure returns None instead of
rolling back the resolution.

### 5. Marketing removed (your decision: cut)

Backend router, web page, mobile screen, and **every entry point** —
sidebar nav, two dashboard tiles, quick-action sheet row, field-network
tile. Grep-verified: zero references remain.

### 6. Phase 3a mobile files installed

`app.json` deleted (it disagreed with `app.config.js` on the app name and
had already drifted on permission strings). Consolidated config with
corrected 9-AM–6-PM wording, full Android location permission set,
`isMonitoringTool` config plugin, disclosure screen, consent service,
My Tracking screen, navigator wiring, `package.json` switched to managed
Expo scripts.

**Not runtime-verified** — see below.

---

## CORRECTION to the earlier plan

The plan listed `POST /auth/register` for deletion, calling it a
self-registration route and "an open door". **That was wrong.** It is
already `require_role(Role.ADMIN)` and has never been publicly reachable.
Only the `/register` *page* looked public, and that is deleted.

What is true is that it duplicates `POST /users`. That collapse is worth
doing but has live test coverage on both sides and no user-visible
benefit, so it was deferred rather than rushed alongside the stock and
location work. The endpoint is annotated in `auth_router.py`.

---

## NOT DONE

| Work | Why it's not here |
|---|---|
| **Expo 49 → 51 upgrade** | Needs your machine and a **physical Android 14 device**. Emulators don't reproduce OEM battery-manager kills. This is a hard Play submission blocker (new apps must target API 34+) |
| **Mobile runtime verification** | No device or simulator available here. The files are syntax-checked, not run |
| **GPS retention job** | The disclosure says 12 months; nothing deletes anything yet, which makes that statement false. Must ship before submission |
| **Ping ring-buffer + `/location/ping/batch`** | GPS pings still share the durable offline queue. An 8-hour low-signal day queues ~1,900 items and replays them with stale timestamps |
| **Tracking watchdog + gap records** | Android OEMs kill background tasks; nothing notices or re-arms |
| **Admin control plane** (`AdminResourceRouter`, recycle bin, password vault, impersonation) | Phase 4. Not started |
| **Bulk product import** | Phase 4. Not started |
| **Day-closure per-officer scoping + publish** | Phase 6. Not started |
| **`dashboard/page.tsx` split** (still 5,029 lines) | Phase 7. Largest remaining regression risk |
| **Frontend/mobile test suites** | No Playwright, no Detox, no Jest. Backend only |
| **80% coverage gate** | Not enforced. Raw-SQL routers still largely untested |

---

## Honest position on "no bugs, now and in future"

Nobody can deliver that. What was delivered is narrower and more useful:
**three classes of bug were made structurally impossible.**

- Stock drift — there is no stored balance to drift, plus DB-level sign
  and non-zero constraints
- Trials escaping deduction — same transaction, same commit
- The UTC day bug returning — a source-guard test fails the build if the
  pattern reappears (it already caught one occurrence I'd missed)

Everything else is still ordinary software with ordinary bugs, and the
frontend and mobile surfaces have no automated tests at all.

---

## Immediate next steps

1. Run `alembic upgrade head` on staging; check `GET /stock/reconciliation`
   against the old `officer_product_stock` values before trusting the
   backfill
2. Allocate real stock via `POST /stock/allocations` — until this runs,
   every officer is still at zero and trials stay blocked
3. `cd mobile && npx expo install --fix && npx expo-doctor`, then test on
   a physical Android 14 phone
4. Build the retention job before anyone sees the disclosure screen
5. Then Phase 4 (admin control plane + bulk import)

## Still open from earlier

1. Returned leftover trial stock — company pool, another officer, or written off?
2. Architecture — converge on thin-router + services, or the other way?
3. Dealer Payments and Enquiry — keep or cut?
4. Confirm 12-month GPS retention
5. Does Vishakan Biotech have Google Workspace? (managed Google Play setup)
