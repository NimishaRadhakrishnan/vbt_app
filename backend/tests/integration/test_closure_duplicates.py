"""A visit logged during the day is not entered again at day closure."""
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.infrastructure.database.session import AsyncSessionLocal, engine
from app.main import app

EMAIL = "dinesh@vishakan.com"


@pytest.fixture
async def client():
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:
        pytest.skip("No database reachable")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def test_today_visits_reused_for_closure_and_duplicates_blocked(client):
    async with AsyncSessionLocal() as s:
        await s.execute(text("UPDATE users SET device_id = NULL, login_status='active' WHERE email = :e"), {"e": EMAIL})
        uid = (await s.execute(text("SELECT id FROM users WHERE email = :e"), {"e": EMAIL})).scalar_one()
        await s.execute(text("DELETE FROM day_closures WHERE officer_id = :u AND date = (now() at time zone 'Asia/Kolkata')::date"), {"u": uid})
        await s.execute(text("DELETE FROM visits WHERE user_id = :u AND start_time >= now() - interval '1 day'"), {"u": uid})
        await s.commit()
    r = await client.post("/api/v1/auth/login", json={"email": EMAIL, "password": "Password123!", "device_id": "dev-dup"})
    assert r.status_code == 200, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    # no visit yet -> cannot close from visits
    base = (await client.get("/api/v1/day-closure/today-visits", headers=h)).json()
    if not base:
        assert (await client.post("/api/v1/day-closure/from-visits", headers=h)).status_code == 409
    async with AsyncSessionLocal() as s:
        fid = (await s.execute(text("SELECT id FROM farmers WHERE is_deleted = false LIMIT 1"))).scalar_one_or_none()
    if fid is None:
        pytest.skip("no farmer in test DB")
    visit = {"latitude": 10.0, "longitude": 20.0, "farm_size_value": 1.0, "farm_size_unit": "cents",
             "farming_type": "conventional", "crop_status": "healthy", "farmer_id": str(fid),
             "config_version": 1, "custom_field_answers": {}}
    r = await client.post("/api/v1/visits/daily-tracker/submit", headers=h, json=visit)
    assert r.status_code == 201, r.text
    # the same farmer again the same day is refused (double entry)...
    r = await client.post("/api/v1/visits/daily-tracker/submit", headers=h, json=visit)
    assert r.status_code == 409 and "already logged" in r.text
    # ...unless it is explicitly a second visit
    r = await client.post("/api/v1/visits/daily-tracker/submit", headers=h, json={**visit, "allow_duplicate_visit": True})
    assert r.status_code == 201, r.text
    vs = (await client.get("/api/v1/day-closure/today-visits", headers=h)).json()
    assert len(vs) >= 1 and vs[-1]["farmer_name"]
    r = await client.post("/api/v1/day-closure/from-visits", headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["closed_today"] is True
    # second call is idempotent, no second closure row
    assert (await client.post("/api/v1/day-closure/from-visits", headers=h)).status_code in (200, 201)
    async with AsyncSessionLocal() as s:
        n = (await s.execute(text("SELECT count(*) FROM day_closures WHERE officer_id = :u AND date = (now() at time zone 'Asia/Kolkata')::date"), {"u": uid})).scalar_one()
        assert n == 1


async def test_farmer_registered_in_a_visit_is_pinned_on_the_map(client):
    async with AsyncSessionLocal() as s:
        await s.execute(text("UPDATE users SET device_id = NULL, login_status='active' WHERE email = :e"), {"e": EMAIL})
        await s.commit()
    r = await client.post("/api/v1/auth/login", json={"email": EMAIL, "password": "Password123!", "device_id": "dev-dup"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    phone = "7" + uuid.uuid4().hex[:9].translate(str.maketrans("abcdef", "123456"))
    visit = {"latitude": 11.1, "longitude": 77.2, "farm_size_value": 1.0, "farm_size_unit": "cents",
             "farming_type": "conventional", "crop_status": "healthy", "config_version": 1, "custom_field_answers": {},
             "new_farmer": {"name": "Pin Test", "phone": phone, "village": "V", "taluk": "T", "district": "D", "crop": "C", "cents": 1.0}}
    r = await client.post("/api/v1/visits/daily-tracker/submit", headers=h, json=visit)
    assert r.status_code == 201, r.text
    async with AsyncSessionLocal() as s:
        row = (await s.execute(text("SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM farmers WHERE phone = :p"), {"p": phone})).first()
        await s.execute(text("DELETE FROM visits WHERE farmer_id IN (SELECT id FROM farmers WHERE phone = :p)"), {"p": phone})
        await s.execute(text("DELETE FROM farmers WHERE phone = :p"), {"p": phone})
        await s.commit()
    assert row and abs(row.lat - 11.1) < 1e-6 and abs(row.lng - 77.2) < 1e-6
