# Roadmap

This tracks what's actually been built for the Field Force Operations &
Administration Platform, based on the delivered changelogs
(`CHANGELOG_FIXES.md`, `_V2`, `_V3`) and the open items they flagged.

## Delivered

| Area | What's in place |
|---|---|
| Foundation | Clean Architecture skeleton, Postgres + PostGIS, Redis, JWT auth with refresh rotation, RBAC (`admin`, `manager`, `sales_officer`, `field_officer`, `dealer`, `farmer`), Docker Compose, Nginx, CI |
| Attendance & Location | GPS check-in/out, live location ping (`officer_locations`) restricted to the authenticated officer's own identity, admin/manager-only live tracking map, "logged in at X from Y" (attendance) shown alongside live GPS status |
| Weekly Planning | Officer-submitted weekly plans with admin/manager approve/disapprove |
| Farmers & Dealers | Registries with district/taluk/village/crop and date-range filters (server-side, not client-side); Sales Officers can add dealers (auto `pending_approval`), Admin/Manager approve or reject |
| Crop Disease Reporting | Photo-based reporting with resolution visible to Admin **and** Manager (not admin-only) |
| Dealer Orders | Real backend (`POST/GET /dealers/{id}/orders`) — previously dead code against a table that was never migrated, now working |
| Task Assignment | Admin/manager-assigned tasks with status flow (`assigned → in_progress → done`/`cancelled`), role-scoped listing, reassignment/completion notifications |
| Productivity Rollup | `GET /productivity/me` (self) and `GET /productivity` (admin/manager, all or by officer) — daily/weekly/monthly aggregation of task completion, attendance, plan submissions, crop issues resolved, visits completed |
| Leave, HR Policy, Enquiry, Day Closure | Leave request + decision workflow, HR policy listing/edit, farmer enquiry intake (with upload) + resolution, daily day-closure submission with an admin "missing today" view |
| Reporting | PDF/Excel report generation |
| Momentum | Points/badges/kudos/personal-best system (`momentum_router.py`, `MomentumWidget.tsx`, `TeamMomentumCard.tsx`) — self view, team view, officer-specific view, badge catalog, per-role targets, kudos giving. Raw-SQL, not yet migrated to the layered pattern (see Architecture) |
| Reliability pass | Removed silent mock-data fallbacks on the dashboard (fake officer/plan/dealer data used to mask real API failures); honest empty-state + visible error banner instead |

## Known open items (from the last delivered round)

- ~~`GET /dealers/search` (default active-only) and the product catalog
  endpoint still have no login requirement at all.~~ `GET /dealers/search`
  was already guarded with `CurrentUser` (this line was stale). The
  product catalog endpoint (`GET /dealers/products/catalog`) genuinely
  had no auth dependency and has now been fixed.
- The mobile app's auth is real (`/auth/login`, `/auth/me` against the
  actual backend). What's still simulated: the offline queue
  (`services/db.ts` is in-memory, not on-device SQLite, so it doesn't
  survive an app restart) and `BACKEND_URL`, which is hardcoded rather
  than configurable per environment.
- Attendance/monitoring alerts, "task must be done before logout", and
  the rest of the larger feature request are pending answers to open
  design questions before being built.

## Requested but not yet started

These come from the original project brief, not yet reflected in the
codebase:

- Redesigned login screen (company logo, employee ID/email + password,
  role selector, no self-registration).
- Header showing portal name + logged-in user.
- A full UI/UX visual overhaul for a more polished, cohesive design.
- A non-punishing motivation feature (cumulative momentum points,
  milestone badges, personal bests — explicitly not streaks, and kept
  private rather than shown on a public leaderboard). Note this is
  distinct from the Productivity Rollup already delivered, which reports
  raw activity metrics rather than gamified points/badges.
- **Missing edit path for day closures:** Officers have no way to correct a mistaken "no activity" reason after submission. The `POST` route is idempotent and safely returns `201` without overwriting, but an explicit `PUT` or `PATCH` endpoint is needed for intentional corrections.
