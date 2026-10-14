"""Admin districts, weekly plans with a period + description, and the stock
request notification (which used to fail on a CHECK constraint)."""
from datetime import timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.infrastructure.database.session import AsyncSessionLocal, engine
from app.infrastructure.config.company_time import company_tz
from app.main import app
from datetime import datetime


@pytest.fixture
async def _ensure_db():
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:
        pytest.skip("No database reachable")


@pytest.fixture
async def client(_ensure_db):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _login(client, email):
    res = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def test_districts_admin_crud_and_officer_read(client):
    admin = await _login(client, "admin@vishakan.com")
    officer = await _login(client, "dinesh@vishakan.com")

    created = await client.post("/api/v1/admin/districts", json={"name": "Testville"}, headers=admin)
    assert created.status_code == 201, created.text
    did = created.json()["id"]

    dup = await client.post("/api/v1/admin/districts", json={"name": "testville"}, headers=admin)
    assert dup.status_code == 409

    # Officers can read the list but not change it.
    names = [d["name"] for d in (await client.get("/api/v1/districts", headers=officer)).json()]
    assert "Testville" in names
    assert (await client.post("/api/v1/admin/districts", json={"name": "Nope"}, headers=officer)).status_code == 403

    renamed = await client.put(f"/api/v1/admin/districts/{did}", json={"name": "Testburg"}, headers=admin)
    assert renamed.status_code == 200 and renamed.json()["name"] == "Testburg"

    assert (await client.delete(f"/api/v1/admin/districts/{did}", headers=admin)).status_code == 200
    names = [d["name"] for d in (await client.get("/api/v1/districts", headers=officer)).json()]
    assert "Testburg" not in names


async def test_weekly_plan_period_description_and_overlap(client):
    officer = await _login(client, "dinesh@vishakan.com")
    me = (await client.get("/api/v1/auth/me", headers=officer)).json()
    async with AsyncSessionLocal() as s:
        await s.execute(text("DELETE FROM weekly_plans WHERE user_id = :u"), {"u": me["id"]})
        await s.commit()

    terr = (await client.get("/api/v1/plans/my-territories", headers=officer)).json()
    assert terr, "officers must always have a territory to pick (one per district)"
    tid = terr[0]["id"]

    today = datetime.now(company_tz()).date()
    start = today + timedelta(days=1)
    end = start + timedelta(days=3)
    body = {"week_start_date": str(start), "end_date": str(end), "summary": "Dealer visits in Salem", "territory_id": tid}

    ok = await client.post("/api/v1/plans/submit", json=body, headers=officer)
    assert ok.status_code == 201, ok.text
    plan = ok.json()
    assert plan["end_date"] == str(end) and plan["summary"] == "Dealer visits in Salem"
    assert len(plan["activities"]) == 4  # one per day

    # Overlapping period is refused with a clear message.
    clash = await client.post("/api/v1/plans/submit", json={**body, "week_start_date": str(start + timedelta(days=2)), "end_date": str(end + timedelta(days=2))}, headers=officer)
    assert clash.status_code == 409 and "already have" in clash.json()["detail"]

    # Validation: end before start, missing description.
    bad_end = await client.post("/api/v1/plans/submit", json={**body, "week_start_date": str(end + timedelta(days=10)), "end_date": str(end + timedelta(days=5))}, headers=officer)
    assert bad_end.status_code == 400
    no_desc = await client.post("/api/v1/plans/submit", json={**body, "week_start_date": str(end + timedelta(days=20)), "end_date": str(end + timedelta(days=21)), "summary": ""}, headers=officer)
    assert no_desc.status_code == 400

    # Admin sees it with the period and description.
    admin = await _login(client, "admin@vishakan.com")
    listed = (await client.get("/api/v1/plans", headers=admin)).json()
    mine = [p for p in listed if p["id"] == plan["id"]]
    assert mine and mine[0]["summary"] == "Dealer visits in Salem"

    async with AsyncSessionLocal() as s:
        await s.execute(text("DELETE FROM weekly_plans WHERE user_id = :u"), {"u": me["id"]})
        await s.commit()


async def test_stock_request_notifies_admins(client):
    officer = await _login(client, "dinesh@vishakan.com")
    async with AsyncSessionLocal() as s:
        pid = (await s.execute(text("SELECT id FROM products LIMIT 1"))).scalar()
        if pid is None:
            await s.execute(text("INSERT INTO products (id, name, sku_code) VALUES (gen_random_uuid(), 'Test Product', 'TST-1')"))
            await s.commit()
            pid = (await s.execute(text("SELECT id FROM products LIMIT 1"))).scalar()
    res = await client.post("/api/v1/stock/request", json={"product_id": str(pid), "quantity": 3}, headers=officer)
    assert res.status_code == 201, res.text
    assert res.json()["notified_count"] >= 1


async def test_both_mode_adds_dealer_part_to_the_farmer_closure(client):
    """An officer in 'both' mode who already filed the farmer part can add the
    dealer part to the same closure instead of being told it is closed."""
    from app.infrastructure.config.company_time import company_today
    officer = await _login(client, "dinesh@vishakan.com")
    me = (await client.get("/api/v1/auth/me", headers=officer)).json()
    uid, today = me["id"], company_today()
    async with AsyncSessionLocal() as s:
        await s.execute(text("UPDATE users SET work_mode = 'both' WHERE id = :u"), {"u": uid})
        await s.execute(text("DELETE FROM day_closures WHERE officer_id = :u AND date = :d"), {"u": uid, "d": today})
        await s.execute(
            text("INSERT INTO day_closures (id, officer_id, date, closure_type, created_at) VALUES (gen_random_uuid(), :u, :d, 'field_visit', now())"),
            {"u": uid, "d": today},
        )
        await s.commit()
    try:
        res = await client.post(
            "/api/v1/day-closure/sales",
            json={"district": "Salem", "dealer_name": "Both Mode Agro", "visit_purpose": "dealer_visit"},
            headers=officer,
        )
        assert res.status_code == 201, res.text
        async with AsyncSessionLocal() as s:
            row = (await s.execute(text("SELECT closure_type FROM day_closures WHERE officer_id = :u AND date = :d"), {"u": uid, "d": today})).first()
        assert row.closure_type == "both"
        st = (await client.get("/api/v1/day-closure/status", headers=officer)).json()
        assert st["closed_today"] and st["sales_done"]
        # Dealer list (admin folder) contains it.
        admin = await _login(client, "admin@vishakan.com")
        dealers = (await client.get("/api/v1/day-closure/sales", headers=admin)).json()
        assert any(d["dealer_name"] == "Both Mode Agro" for d in dealers)
    finally:
        async with AsyncSessionLocal() as s:
            await s.execute(text("DELETE FROM day_closures WHERE officer_id = :u AND date = :d"), {"u": uid, "d": today})
            await s.commit()
