"""Deleting a farmer must never 500.

Before the fix, ``DELETE /api/v1/farmers/{id}`` ran an unguarded
``DELETE FROM farmers``. Postgres then tried to honour
``visits_farmer_id_fkey ON DELETE SET NULL``, which ``check_visit_target``
immediately refused, so the request died with CheckViolation -> 500. Any
farmer who had ever been visited was undeletable, and the admin was shown
nothing that explained why.

These tests pin the three outcomes that must hold:
  * a farmer with visits is archived, with a readable message
  * a farmer with no visits is really gone
  * a farmer that does not exist is a 404, not a cheerful "success"
"""

from __future__ import annotations

import random
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.infrastructure.database.session import AsyncSessionLocal
from app.main import app


async def _admin_headers(client: AsyncClient) -> dict[str, str]:
    async with AsyncSessionLocal() as session:
        res = await session.execute(
            text(
                "SELECT email FROM users "
                "WHERE role = 'admin' AND is_active = true AND is_deleted = false "
                "ORDER BY created_at LIMIT 1"
            )
        )
        email = res.scalar()
    if not email:
        pytest.skip("No seeded admin available")
    login = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "Password123!"}
    )
    if login.status_code != 200:
        pytest.skip(f"Admin login unavailable: {login.status_code}")
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _make_farmer(session, name: str) -> uuid.UUID:
    farmer_id = uuid.uuid4()
    await session.execute(
        text(
            """
            INSERT INTO farmers (id, name, phone, district, taluk, village, crop, cents,
                                 created_at, updated_at, is_deleted)
            VALUES (:id, :name, :phone, 'Salem', 'Attur', 'Testpalayam', 'Paddy', 10,
                    now(), now(), false)
            """
        ),
        {"id": farmer_id, "name": name, "phone": str(random.randint(6000000000, 9999999999))},
    )
    return farmer_id


@pytest.mark.asyncio
async def test_farmer_with_visits_is_archived_not_500() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _admin_headers(client)

        async with AsyncSessionLocal() as session:
            farmer_id = await _make_farmer(session, "FK Guard Farmer")
            officer = await session.execute(
                text(
                    "SELECT id FROM users WHERE role = 'field_officer' "
                    "AND is_deleted = false ORDER BY created_at LIMIT 1"
                )
            )
            officer_id = officer.scalar()
            if officer_id is None:
                pytest.skip("No field officer seeded")
            await session.execute(
                text(
                    """
                    INSERT INTO visits (id, user_id, visit_type, farmer_id, dealer_id,
                                        start_time, end_time, created_at, updated_at,
                                        location_start, location_end, purpose)
                    VALUES (gen_random_uuid(), :uid, 'farmer', :fid, NULL,
                            now(), now(), now(), now(),
                            ST_SetSRID(ST_MakePoint(78, 11), 4326)::geography,
                            ST_SetSRID(ST_MakePoint(78, 11), 4326)::geography,
                            'fk guard test')
                    """
                ),
                {"uid": officer_id, "fid": farmer_id},
            )
            await session.commit()

        res = await client.delete(f"/api/v1/farmers/{farmer_id}", headers=headers)
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["result"] == "archived", body
        assert "archived" in body["message"].lower()

        async with AsyncSessionLocal() as session:
            still_there = await session.execute(
                text("SELECT is_deleted FROM farmers WHERE id = :id"), {"id": farmer_id}
            )
            assert still_there.scalar() is True, "archived farmer must still exist"
            visits_kept = await session.execute(
                text("SELECT count(*) FROM visits WHERE farmer_id = :id"), {"id": farmer_id}
            )
            assert visits_kept.scalar() == 1, "visit history must survive the archive"

            await session.execute(
                text("DELETE FROM visits WHERE farmer_id = :id"), {"id": farmer_id}
            )
            await session.execute(text("DELETE FROM farmers WHERE id = :id"), {"id": farmer_id})
            await session.commit()


@pytest.mark.asyncio
async def test_farmer_without_visits_is_hard_deleted() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _admin_headers(client)

        async with AsyncSessionLocal() as session:
            farmer_id = await _make_farmer(session, "Unvisited Farmer")
            await session.commit()

        res = await client.delete(f"/api/v1/farmers/{farmer_id}", headers=headers)
        assert res.status_code == 200, res.text
        assert res.json()["result"] == "deleted", res.text

        async with AsyncSessionLocal() as session:
            gone = await session.execute(
                text("SELECT count(*) FROM farmers WHERE id = :id"), {"id": farmer_id}
            )
            assert gone.scalar() == 0


@pytest.mark.asyncio
async def test_deleting_missing_farmer_is_404_not_success() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _admin_headers(client)
        res = await client.delete(f"/api/v1/farmers/{uuid.uuid4()}", headers=headers)
        assert res.status_code == 404, res.text
