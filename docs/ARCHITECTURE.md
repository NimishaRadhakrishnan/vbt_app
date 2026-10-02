# Architecture

## Layering (Clean Architecture) — as designed

```
presentation  →  application  →  domain
      ↑               ↑
infrastructure ───────┘
```

The dependency rule: arrows only point inward. `domain` depends on nothing.
`application` depends only on `domain`. `infrastructure` depends on
`domain` + `application`'s interfaces. `presentation` depends on
`application`'s use cases.

### `domain/`
Entities, value objects (`Email`, `Role`), domain exceptions, and
repository *interfaces*. Pure Python — no FastAPI, no SQLAlchemy.
Real entities backing this app: `User`, `Attendance`, `GpsTrack`,
`WeeklyPlan`, `Visit`, `Farmer`, `Dealer`, `CropIssue`, `DailyWorkReport`,
`Expense`, `Notification`.

### `application/`
Use cases orchestrate domain objects and depend on interfaces
(`PasswordHasher`, `TokenService`, notification repository) that
infrastructure implements. DTOs are the use case I/O shape — deliberately
distinct from the API's Pydantic schemas.

### `infrastructure/`
Concrete implementations: SQLAlchemy repositories, `BcryptPasswordHasher`,
`JWTTokenService`, the async engine/session factory, the Redis client, and
centralized `Settings`. This is the only layer that imports SQLAlchemy,
passlib, PyJWT, or redis-py directly.

### `presentation/`
FastAPI routers, Pydantic request/response schemas, and middleware
(request-id/logging, security headers, the global exception handler, the
login rate limiter).

## Layering — as actually implemented

The original modules (auth, attendance, GPS tracking/location, weekly
planning, visits, farmers, dealers, crop issues, reporting, daily
reports, user management, notifications) follow the layering above in
full: entity → repository interface → SQLAlchemy repository → use case →
router.

The modules added afterward — **Task Assignment, Productivity Rollup,
Leave, HR Policy, Enquiry, and Day Closure** — do **not** follow this
layering. Their routers (`task_router.py`, `productivity_router.py`,
`leave_router.py`, `hr_policy_router.py`, `enquiry_router.py`,
`day_closure_router.py`) query the database directly via raw
`sqlalchemy.text()` calls, with no domain entity, repository, or use
case in between. They do reuse the shared `require_role` / `CurrentUser`
auth dependencies and, where relevant, the real `NotificationRepository`
for firing notifications — but the business logic itself lives in the
router. This is a real architectural inconsistency in the current
codebase, not a design decision to preserve; bringing these six modules
in line with the rest (entity + repository + use case) is on the
roadmap, not yet done.

## Dependency Injection

`app/core/container.py` is the composition root: use cases that do
follow the full layering get a factory function (e.g.
`get_notification_repository`) that FastAPI's `Depends` resolves per
request. The raw-SQL routers instead depend directly on
`get_db_session`.

## Auth design

- **Passwords**: bcrypt via passlib (`BcryptPasswordHasher`).
- **Access tokens**: short-lived stateless JWTs (HS256), verified by
  signature — no DB/Redis round trip on every request.
- **Refresh tokens**: opaque random strings; only their SHA-256 hash is
  stored in Redis (mapped to `user_id:role`) with a TTL. This makes
  individual sessions revocable (logout, suspected compromise), which a
  bare stateless JWT refresh token cannot do.
- **Rotation-on-use**: every `/auth/refresh` call deletes the old
  refresh-token key and issues a new pair. Reusing an already-rotated
  refresh token is rejected.
- **RBAC**: `Role` enum — `admin`, `manager`, `sales_officer`,
  `field_officer`, `dealer`, `farmer` — on `User`. `require_role(...)` in
  `presentation/api/v1/dependencies.py` is the reusable guard every
  module (old and new alike) depends on for role-gated endpoints.

## Real-time layer

A WebSocket endpoint (`/ws/alerts`, via `websocket_router.py`) and a
Redis pub/sub broadcaster (`RedisPubSubBroadcaster`) are wired into the
app. This is an active data path: `AlertsService.evaluate_location`
(invoked from `location_router`'s `/location/ping`) publishes
battery-critical and mock-location alerts to the Redis `alerts` channel
on every qualifying ping, and the dashboard (`frontend/app/dashboard/page.tsx`)
holds an open subscription to `/ws/alerts` that triggers a refetch of
live officer positions on message. Note: `/ws/alerts` itself currently
has no authentication check on the connection — unlike `/ws/locations`
(`location_ws_router.py`), which verifies a JWT passed as a query param.

## Observability

Every log line is structured JSON (`app/core/logging_config.py`).
`RequestContextMiddleware` generates/propagates a `request_id`, attaches
it to every log line and error response for that request, and logs one
`request_completed` event per request with method/path/status/duration.

## Inherited scaffold (removed)

This repo was originally bootstrapped from an "MCP Server Risk Scanner"
project. That scaffold has been fully removed — no `alert_router`,
`audit_router`, `capability_router`, `connection_router`,
`discovery_router`, `governance_router`, `policy_router`,
`risk_card_router`, `risk_router`, or `scanning_router`; no `Alert`,
`AuditLog`, `Connection`, `GovernanceRecommendation`, `McpServer`,
`Policy`, `RiskCard`, `RiskFinding`, or `ToolCapability` domain entities,
models, repositories, or use cases; no `infrastructure/mcp_client/`. This
codebase's real notifications go through the DB-backed
`NotificationRepository`.

## How to add a new module (the layering to actually follow)

1. A domain entity + repository interface in `domain/`.
2. A use case + DTOs in `application/`.
3. A SQLAlchemy model + repository implementation in `infrastructure/`,
   plus an Alembic migration.
4. A router + schemas in `presentation/`, registered in
   `presentation/api/v1/router.py`.
5. A factory function added to `core/container.py`.
6. Unit tests against fakes; integration tests against the real stack.

This is the pattern the original modules follow. Task/Productivity/
Leave/HR-Policy/Enquiry/Day-Closure are the exception, not the template —
new work should follow this list, not copy those routers' raw-SQL
shortcut.