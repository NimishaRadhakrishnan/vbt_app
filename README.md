# Vishakan Biotech — Field Force Operations & Administration Platform

A role-based enterprise web app for managing Vishakan Biotech's field
operations: GPS attendance and live location tracking, weekly plan
submission/approval, farmer and dealer registries with photo-based crop
disease reporting, task assignment, productivity rollups, leave/HR-policy
and day-closure workflows, and PDF/Excel reporting — for Admins, Regional
Managers, Sales Officers, Field Officers, Dealers, and Farmers.

A companion React Native mobile app (`mobile/`) covers the same core
field-officer flows (attendance, visits, weekly plans, farmer/dealer
lookup, crop issue reporting). Its auth is real — it calls the actual
`/auth/login` and `/auth/me` endpoints, not a mock token. The two
simulations this file used to warn about are gone: the offline queue is
now backed by AsyncStorage and survives an app restart
(`mobile/src/services/db.ts`), and the API base URL comes from
`EXPO_PUBLIC_API_URL` with `localhost:8000` only as a fallback.

The mobile app has not been built or run since those changes — no Android
toolchain was available for the production pass — so treat a device build
as untested, not as broken.

## Start here

| File | What it is |
| --- | --- |
| [`HANDOVER.html`](HANDOVER.html) | Everything below as one page — open it in a browser, no server needed. |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | **Deploying to a Hostinger KVM 2 VPS behind Cloudflare** — step by step, plus measured capacity (how many officers this machine supports). |
| [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md) | What was verified, the twelve defects found and fixed, what is still open, and the deployment checklist. **Read before deploying.** |
| [`DEMO.html`](DEMO.html) | The demo walkthrough **with screenshots of every screen**, captured from the running app. Open in a browser. |
| [`DEMO.md`](DEMO.md) | The same walkthrough as plain text, for reading in a terminal or editor. |
| `backend/scripts/demo_seed.py` | Loads realistic demo data. Safe to re-run. |
| `backend/.env.production.example` | Production configuration template, filled in and annotated. |

## Quickstart

```bash
# 1. Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env: set JWT_SECRET_KEY (openssl rand -hex 32) and POSTGRES_PASSWORD

cp frontend/.env.example frontend/.env.local

# 2. Start everything
docker compose up --build

# 3. Run database migrations (first time, or after pulling new migrations)
docker compose exec backend alembic upgrade head

# 4. Load demo data — officers, farmers, dealers, products, a week of visits
docker compose exec backend python scripts/demo_seed.py
```

Without step 4 the app comes up empty and every screen looks broken. The
script prints the sign-in details when it finishes.

- Frontend: http://localhost:3000
- Backend API docs (Swagger): http://localhost:8000/docs
- Via Nginx (proxies both): http://localhost

## Local development (without Docker)

**Backend**
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

## Running tests

```bash
docker compose exec backend python -m pytest tests/ -q

cd frontend
npm run type-check && npm run lint && npm test && npm run build
```

The suite expects a **reachable, migrated, seeded** database. Older tests
skip themselves when Postgres is unreachable; the newer ones fail with a
connection error instead, which is a clearer signal than a green run that
tested nothing. Run `alembic upgrade head` and `scripts/demo_seed.py`
first.

Expect `228 passed, 1 skipped` from the backend and `18 passed` from
`npm test`. The skip is `test_working_hours_logout.py`, which is only
meaningful after working hours on a working day.

Note that the backend container has **no volume mount** — rebuild the
image before testing a code change, or you will be running the old code:

```bash
docker compose build backend && docker compose up -d backend
```

## Project structure

```
backend/    FastAPI service — Clean Architecture (domain/application/infrastructure/presentation)
frontend/   Next.js + TypeScript + Tailwind — single role-aware dashboard (login, register, dashboard)
mobile/     React Native prototype for field officers (attendance, visits, plans, farmers, dealers, crop issues)
infra/      Nginx reverse proxy config
docker-compose.yml   Full local orchestration (Postgres + PostGIS, Redis, backend, frontend, Nginx)
.github/workflows/   CI pipeline (backend lint/type-check/test, frontend type-check/lint/build)
docs/       Architecture and roadmap documentation
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the layering rationale
and current module inventory, and [docs/ROADMAP.md](docs/ROADMAP.md) for
what's shipped and what's still open.

## Note on inherited scaffolding

This backend was originally bootstrapped from a different project (an
"MCP Server Risk Scanner" governance tool). The routers, entities and use
cases were removed early on, and this file said the job was finished — but
it was not. Eight of that project's **tables** were still being created by
migrations on every install (`mcp_servers`, `tool_capabilities`,
`risk_findings`, `risk_cards`, `governance_recommendations`, `alerts`,
`connections`, `policies`), the app still announced itself as
`APP_NAME="MCP Server Risk Scanner"`, and the browser stored its session
under `mcp_scanner_refresh_token`.

All of that is gone as of migration `202609290002`, which also drops the
two Marketing tables left behind when that module was cut. Ten tables in
total; none were referenced by any file under `app/`.

The history of this repository still contains the old project's committed
`JWT_SECRET_KEY`. That key is no longer in use, and a production
deployment must not fall back to it — `app/main.py` refuses to start if it
does.