from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.infrastructure.database.session import AsyncSessionLocal, engine
from app.main import app


async def _database_reachable() -> bool:
    # Same explanation as test_auth_flow.py's _database_reachable: the
    # module-level engine singleton's pool binds to a since-closed event
    # loop by the time later test functions reach this check
    # (pytest-asyncio's function-scoped loops), so disposing first forces
    # a fresh connection bound to the currently-running loop instead of
    # a stale one that would otherwise be silently misreported as
    # "unreachable".
    try:
        await engine.dispose()
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


async def _register_and_login_test_officer(client: AsyncClient) -> tuple[str, str]:
    """Returns (officer_user_id, admin_access_token). Registers via the
    admin-gated /auth/register (see test_auth_flow.py for why an
    anonymous register call would 403), then fetches the officer's real
    id via /auth/me - NOT tokens["user"]["id"], which test_location_flow.py
    uses but which doesn't actually exist on the real /auth/login response
    shape (a separate, already-known, pre-existing bug; not copied here
    since there's no reason to start a new test off already broken)."""
    admin_login = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@vishakan.com", "password": "Password123!"},
    )
    assert admin_login.status_code == 200, (
        "Seeded admin login failed - run `python scripts/demo_seed.py` against "
        "this database before running the integration suite."
    )
    admin_token = admin_login.json()["access_token"]

    unique_email = f"history-test-{uuid.uuid4().hex[:10]}@example.com"
    register_response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": unique_email,
            "password": "Password123!",
            "full_name": "Test History Officer",
            "role": "field_officer",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert register_response.status_code == 201, register_response.text

    officer_login = await client.post(
        "/api/v1/auth/login", json={"email": unique_email, "password": "Password123!"}
    )
    assert officer_login.status_code == 200
    officer_token = officer_login.json()["access_token"]

    me_response = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {officer_token}"}
    )
    assert me_response.status_code == 200
    officer_id = me_response.json()["id"]

    return officer_id, admin_token


@pytest.mark.asyncio
async def test_history_returns_pings_in_ascending_order() -> None:
    if not await _database_reachable():
        pytest.skip("Database not reachable in this environment; run via docker-compose or CI.")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        officer_id, admin_token = await _register_and_login_test_officer(client)

        # Seeded out of chronological order deliberately, to actually
        # exercise the ORDER BY recorded_at ASC clause rather than just
        # happening to pass because insertion order matched query order.
        async with AsyncSessionLocal() as session:
            for minute in (10, 0, 5):
                await session.execute(
                    text("""
                        INSERT INTO gps_tracks (
                            id, user_id, recorded_at, location, accuracy, speed,
                            is_idle, distance_from_prev, territory_violation, battery_level, created_at
                        )
                        VALUES (
                            gen_random_uuid(), :uid, :recorded_at,
                            ST_SetSRID(ST_MakePoint(78.146, 11.6643), 4326)::geography,
                            25.0, 4.0, false, 0.0, false, 75, now()
                        )
                    """),
                    {"uid": officer_id, "recorded_at": datetime(2026, 8, 1, 9, minute, 0, tzinfo=UTC)},
                )
            await session.commit()

        response = await client.get(
            f"/api/v1/location/history/{officer_id}",
            params={"date": "2026-08-01"},
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert response.status_code == 200
        rows = response.json()
        assert len(rows) == 3
        recorded_minutes = [datetime.fromisoformat(r["recorded_at"].replace("Z", "+00:00")).minute for r in rows]
        assert recorded_minutes == [0, 5, 10], f"expected ascending order, got {recorded_minutes}"
        # accuracy (metres) is returned so the Route Replay screen can ignore poor fixes.
        assert all(r["accuracy"] == 25.0 for r in rows)


@pytest.mark.asyncio
async def test_history_returns_empty_list_for_date_with_no_pings() -> None:
    if not await _database_reachable():
        pytest.skip("Database not reachable in this environment; run via docker-compose or CI.")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        officer_id, admin_token = await _register_and_login_test_officer(client)

        # No gps_tracks rows seeded for this officer at all - a freshly
        # registered officer has none, so any date is a "no pings" date.
        response = await client.get(
            f"/api/v1/location/history/{officer_id}",
            params={"date": "2026-08-01"},
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert response.status_code == 200
        assert response.json() == []


@pytest.mark.asyncio
async def test_history_returns_clean_error_for_invalid_date() -> None:
    if not await _database_reachable():
        pytest.skip("Database not reachable in this environment; run via docker-compose or CI.")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        officer_id, admin_token = await _register_and_login_test_officer(client)

        response = await client.get(
            f"/api/v1/location/history/{officer_id}",
            params={"date": "not-a-real-date"},
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        # The bug this endpoint had: an invalid/mistyped date used to
        # reach the database unparsed and crash with a raw asyncpg
        # UndefinedFunctionError (surfaced to the caller as a generic
        # 500), instead of being validated before ever touching the DB.
        assert response.status_code == 400
        assert "detail" in response.json()
