from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.infrastructure.database.session import engine
from app.main import app


async def _database_reachable() -> bool:
    # See test_auth_flow.py's _database_reachable for the full
    # explanation: the module-level engine singleton's connection pool
    # gets bound to a since-closed event loop by the time later test
    # functions reach this check (pytest-asyncio's function-scoped event
    # loops), so a stale connection raises a RuntimeError the bare except
    # below used to silently misreport as "unreachable". Disposing first
    # forces a fresh connection bound to the currently-running loop.
    try:
        await engine.dispose()
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


@pytest.mark.asyncio
async def test_location_ping_and_active() -> None:
    if not await _database_reachable():
        pytest.skip("Database not reachable in this environment; run via docker-compose or CI.")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # /auth/register is admin-gated - see test_auth_flow.py for the
        # full explanation. Same fix here: log in as the seeded demo
        # admin first to get a token for the register call below.
        admin_login = await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@vishakan.com", "password": "Password123!"},
        )
        assert admin_login.status_code == 200, (
            "Seeded admin login failed - run `python scripts/demo_seed.py` against "
            "this database before running the integration suite."
        )
        admin_token = admin_login.json()["access_token"]

        # 1. Register a test officer
        unique_email = f"officer-{uuid.uuid4().hex[:10]}@example.com"
        register_response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": unique_email,
                "password": "Password123!",
                "full_name": "Test Location Officer",
                "role": "field_officer"
            },
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert register_response.status_code == 201

        # 2. Login to get token
        login_response = await client.post(
            "/api/v1/auth/login",
            json={"email": unique_email, "password": "Password123!"},
        )
        assert login_response.status_code == 200
        tokens = login_response.json()
        access_token = tokens["access_token"]

        me_response = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access_token}"})
        user_id = me_response.json()["id"]

        # 3. Send location ping
        ping_response = await client.post(
            "/api/v1/location/ping",
            headers={"Authorization": f"Bearer {access_token}"},
            json={
                "officer_id": user_id,
                "lat": 12.3456,
                "lng": 78.9012,
                "speed_kmh": 4.5,
                "battery_pct": 92,
                "status": "active",
                "timestamp": datetime.now(UTC).isoformat()
            }
        )
        assert ping_response.status_code == 200
        assert ping_response.json() == {"status": "success"}

        # 4. Fetch active locations
        active_response = await client.get(
            "/api/v1/location/active",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert active_response.status_code == 200
        active_list = active_response.json()

        # Verify the ping details are correct
        officer_loc = next((x for x in active_list if x["officer_id"] == user_id), None)
        assert officer_loc is not None
        assert officer_loc["latitude"] == 12.3456
        assert officer_loc["longitude"] == 78.9012
        assert officer_loc["speed"] == 4.5
        assert officer_loc["battery_level"] == 92
        assert officer_loc["status"] == "active"
