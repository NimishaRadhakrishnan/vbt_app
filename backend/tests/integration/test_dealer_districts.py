"""Admin assigns districts to an officer; officer's dealer list is scoped to them."""
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


async def _login(client, email):
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!", "device_id": "dev-dist-test"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def test_district_scoped_dealers(client):
    async with AsyncSessionLocal() as s:
        await s.execute(text("UPDATE users SET device_id = NULL WHERE email = :e"), {"e": EMAIL})
        await s.commit()
    admin = await _login(client, "admin@vishakan.com")
    tag = uuid.uuid4().hex[:6]
    da, db = f"DistA{tag}", f"DistB{tag}"
    for i, d in enumerate((da, db)):
        r = await client.post("/api/v1/dealers/", headers=admin, json={
            "name": f"Dealer {d}", "phone": f"9{tag}{i}0000"[:10].ljust(10, "1"), "district": d,
            "duplicate_check_acknowledged": True})
        assert r.status_code in (200, 201), r.text
        assert r.json()["status"] == "active"
    off = await _login(client, EMAIL)
    me = (await client.get("/api/v1/auth/me", headers=off)).json() if (await client.get("/api/v1/auth/me", headers=off)).status_code == 200 else None
    async with AsyncSessionLocal() as s:
        uid = (await s.execute(text("SELECT id FROM users WHERE email = :e"), {"e": EMAIL})).scalar_one()
        await s.execute(text("DELETE FROM user_territories WHERE user_id = :u"), {"u": uid})
        await s.commit()
    # unassigned: sees both
    names = {d["district"] for d in (await client.get("/api/v1/dealers/search?limit=500", headers=off)).json()}
    assert da in names and db in names
    # admin assigns district A
    r = await client.post(f"/api/v1/users/{uid}/assignments", headers=admin, json={"districts": [da]})
    assert r.status_code == 200, r.text
    assert (await client.get(f"/api/v1/users/{uid}/districts", headers=admin)).json() == [da]
    names = {d["district"] for d in (await client.get("/api/v1/dealers/search?limit=500", headers=off)).json()}
    assert da in names and db not in names
    # clearing restores full view
    await client.post(f"/api/v1/users/{uid}/assignments", headers=admin, json={"districts": []})
    names = {d["district"] for d in (await client.get("/api/v1/dealers/search?limit=500", headers=off)).json()}
    assert db in names


async def test_admin_can_delete_dealer_and_reuse_phone(client):
    admin = await _login(client, "admin@vishakan.com")
    off = await _login(client, EMAIL)
    tag = uuid.uuid4().hex[:6]
    phone = ("8" + tag + "1234567")[:10]
    body = {"name": f"Del {tag}", "phone": phone, "district": f"DelD{tag}", "duplicate_check_acknowledged": True}
    r = await client.post("/api/v1/dealers/", headers=admin, json=body)
    assert r.status_code in (200, 201), r.text
    did = r.json()["id"]
    assert (await client.delete(f"/api/v1/dealers/{did}", headers=off)).status_code == 403
    assert (await client.delete(f"/api/v1/dealers/{did}", headers=admin)).status_code == 204
    assert (await client.delete(f"/api/v1/dealers/{did}", headers=admin)).status_code == 404
    assert did not in {d["id"] for d in (await client.get("/api/v1/dealers/search?limit=500", headers=admin)).json()}
    assert (await client.post("/api/v1/dealers/", headers=admin, json=body)).status_code in (200, 201)
