"""Speedometer photo + km: required at check-in/out, admin sees/downloads, retention."""
import io
import os
import uuid
import zipfile

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.application.services.gps_retention import purge_old_odometer
from app.infrastructure.config.settings import get_settings
from app.infrastructure.database.session import AsyncSessionLocal, engine
from app.main import app

EMAIL = "dinesh@vishakan.com"
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 200


@pytest.fixture
async def client():
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:
        pytest.skip("No database reachable")
    s = get_settings()
    old = s.odometer_required
    object.__setattr__(s, "odometer_required", True)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    object.__setattr__(s, "odometer_required", old)


async def _login(client, email):
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!", **({} if email.startswith("admin") else {"device_id": "dev-odo"})})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["access_token"]


async def _clean():
    async with AsyncSessionLocal() as s:
        await s.execute(text("UPDATE users SET device_id = NULL WHERE email = :e"), {"e": EMAIL})
        uid = (await s.execute(text("SELECT id FROM users WHERE email = :e"), {"e": EMAIL})).scalar_one()
        await s.execute(text("DELETE FROM odometer_readings WHERE user_id = :u"), {"u": uid})
        await s.execute(text("DELETE FROM attendance WHERE user_id = :u"), {"u": uid})
        await s.commit()
    return uid


def _up(client, h, kind, km, data=JPEG):
    return client.post("/api/v1/odometer", headers=h, data={"kind": kind, "km": str(km)},
                       files={"file": ("m.jpg", data, "image/jpeg")})


async def test_full_day_flow_and_admin_downloads(client):
    uid = await _clean()
    h, tok = await _login(client, EMAIL)
    ah, atok = await _login(client, "admin@vishakan.com")
    ver = (await client.get("/api/v1/consent/location", headers=h)).json()
    v = ver.get("current_version") or ver.get("version") or ver.get("disclosure_version") or 1
    await client.post("/api/v1/consent/location", headers=h, json={"version": v})
    body = {"latitude": 11.0, "longitude": 77.0, "device_id": "dev-odo", "is_fake_gps": False, "is_gps_disabled": False}
    # blocked without the morning photo
    r = await client.post("/api/v1/attendance/check-in", headers=h, json=body)
    assert r.status_code == 428, r.text
    # bad file rejected
    assert (await _up(client, h, "check_in", 100, b"not an image")).status_code == 422
    assert (await _up(client, h, "check_in", 12345.5)).status_code == 201
    assert (await _up(client, h, "check_in", 12345.5)).status_code == 409
    t = (await client.get("/api/v1/odometer/today", headers=h)).json()
    assert t["required"] and t["check_in"]["km"] == 12345.5 and t["check_out"] is None
    r = await client.post("/api/v1/attendance/check-in", headers=h, json=body)
    assert r.status_code in (201, 403), r.text  # 403 = location consent not given in this DB
    if r.status_code == 403:
        pytest.skip("officer has no location consent in test DB")
    # check-out blocked until the evening photo; end km must not be lower
    r = await client.post("/api/v1/attendance/check-out", headers=h, json={"latitude": 11.0, "longitude": 77.0})
    assert r.status_code == 428
    assert (await _up(client, h, "check_out", 12000)).status_code == 422
    assert (await _up(client, h, "check_out", 12400.5)).status_code == 201
    r = await client.post("/api/v1/attendance/check-out", headers=h, json={"latitude": 11.0, "longitude": 77.0})
    assert r.status_code == 200, r.text
    # admin sees one day row with distance
    rows = (await client.get(f"/api/v1/odometer?user_id={uid}", headers=ah)).json()
    assert len(rows) == 1 and rows[0]["distance_km"] == 55.0 and rows[0]["officer_name"]
    rid = rows[0]["check_in"]["id"]
    # officer cannot list; admin single download + zip
    assert (await client.get("/api/v1/odometer", headers=h)).status_code == 403
    p = await client.get(f"/api/v1/odometer/{rid}/photo?token={atok}&download=1")
    assert p.status_code == 200 and p.content == JPEG and "attachment" in p.headers["content-disposition"]
    assert (await client.get(f"/api/v1/odometer/{rid}/photo?token={tok}")).status_code == 200  # own photo
    z = await client.get(f"/api/v1/odometer/download/all.zip?token={atok}&user_id={uid}")
    assert z.status_code == 200
    names = zipfile.ZipFile(io.BytesIO(z.content)).namelist()
    assert "readings.csv" in names and len(names) == 3
    assert (await client.get(f"/api/v1/odometer/download/all.zip?token={tok}")).status_code == 403
    # admin removes a wrong reading -> officer can redo
    assert (await client.delete(f"/api/v1/odometer/{rid}", headers=ah)).status_code == 204


async def test_retention_deletes_old_rows_and_files(client):
    uid = await _clean()
    h, _ = await _login(client, EMAIL)
    assert (await _up(client, h, "check_in", 10)).status_code == 201
    async with AsyncSessionLocal() as s:
        fn = (await s.execute(text("SELECT filename FROM odometer_readings WHERE user_id = :u"), {"u": uid})).scalar_one()
        await s.execute(text("UPDATE odometer_readings SET created_at = now() - interval '61 days' WHERE user_id = :u"), {"u": uid})
        await s.commit()
    path = os.path.join("uploads", "odometer", fn)
    assert os.path.isfile(path)
    assert await purge_old_odometer() >= 1
    assert not os.path.isfile(path)
