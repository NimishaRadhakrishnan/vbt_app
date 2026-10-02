"""The stock loop, end to end, over HTTP.

Until this existed the suite proved the *rejection* path (a trial larger
than the balance is refused) but never the success path - the one every
officer uses daily: stock is issued, a trial is given, the balance drops
by exactly that much. That gap is why "Insufficient stock ... Available:
0.0" reached a real screen.

Issue 50 -> give 5 -> read 45, then prove an overdraw changes nothing.
"""

from __future__ import annotations

import random

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.infrastructure.database.session import AsyncSessionLocal
from app.main import app


async def _balance(client: AsyncClient, headers: dict, product_id) -> float | None:
    resp = await client.get("/api/v1/stock/my-stock", headers=headers)
    assert resp.status_code == 200, resp.text
    for row in resp.json():
        if str(row["product_id"]) == str(product_id):
            return float(row["current_quantity"])
    return None


def _visit_payload(product_id, quantity: float, farmer_name: str) -> dict:
    return {
        "latitude": 11.66,
        "longitude": 78.14,
        "farm_size_value": 1.0,
        "farm_size_unit": "cents",
        "farming_type": "conventional",
        "crop_status": "healthy",
        "config_version": 1,
        "custom_field_answers": {},
        "is_trial": True,
        "demo_status": "started_today",
        "visit_purpose": "demo_setup",
        "trial_plot_size_cents": 1,
        "new_farmer": {
            "name": farmer_name,
            "phone": str(random.randint(6000000000, 9999999999)),
            "village": "Testpalayam",
            "taluk": "Attur",
            "district": "Salem",
            "crop": "Paddy",
            "cents": 1.0,
        },
        "trial_products": [{"product_id": str(product_id), "quantity_given": quantity}],
    }


@pytest.mark.asyncio
async def test_issue_fifty_give_five_read_fortyfive() -> None:
    async with AsyncSessionLocal() as session:
        officer = (
            await session.execute(
                text(
                    "SELECT id, email FROM users WHERE role = 'field_officer' "
                    "AND is_active = true AND is_deleted = false ORDER BY created_at LIMIT 1"
                )
            )
        ).first()
        admin_email = (
            await session.execute(
                text(
                    "SELECT email FROM users WHERE role = 'admin' AND is_active = true "
                    "AND is_deleted = false ORDER BY created_at LIMIT 1"
                )
            )
        ).scalar()
        product_id = (
            await session.execute(text("SELECT id FROM products WHERE is_active = true LIMIT 1"))
        ).scalar()

    if not (officer and admin_email and product_id):
        pytest.skip("Seeded officer/admin/product not available")

    async with AsyncSessionLocal() as session:
        await session.execute(
            text("DELETE FROM stock_ledger WHERE officer_id = :o AND product_id = :p"),
            {"o": officer.id, "p": product_id},
        )
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        admin = await client.post(
            "/api/v1/auth/login", json={"email": admin_email, "password": "Password123!"}
        )
        off = await client.post(
            "/api/v1/auth/login", json={"email": officer.email, "password": "Password123!"}
        )
        if admin.status_code != 200 or off.status_code != 200:
            pytest.skip("Seeded logins unavailable")
        A = {"Authorization": f"Bearer {admin.json()['access_token']}"}
        O = {"Authorization": f"Bearer {off.json()['access_token']}"}

        issued = await client.post(
            "/api/v1/stock/allocations",
            headers=A,
            json={
                "allocations": [
                    {"officer_id": str(officer.id), "product_id": str(product_id), "quantity": 50}
                ]
            },
        )
        assert issued.status_code == 201, issued.text
        assert await _balance(client, O, product_id) == 50.0

        given = await client.post(
            "/api/v1/visits/daily-tracker/submit",
            headers=O,
            json=_visit_payload(product_id, 5, "Walkthrough Farmer"),
        )
        assert given.status_code == 201, given.text
        assert await _balance(client, O, product_id) == 45.0, "trial did not deduct from the ledger"

        overdraw = await client.post(
            "/api/v1/visits/daily-tracker/submit",
            headers=O,
            json=_visit_payload(product_id, 999, "Overdraw Farmer"),
        )
        assert overdraw.status_code == 400, overdraw.text
        assert await _balance(client, O, product_id) == 45.0, "rejected trial still moved the ledger"

    async with AsyncSessionLocal() as session:
        await session.execute(
            text("DELETE FROM stock_ledger WHERE officer_id = :o AND product_id = :p"),
            {"o": officer.id, "p": product_id},
        )
        await session.commit()


@pytest.mark.asyncio
async def test_unknown_visit_purpose_is_422_not_500() -> None:
    """An invalid visit_purpose used to reach Postgres and raise
    CheckViolation, which the client saw as a bare 500. The schema now
    mirrors ck_visit_trial_purpose, so the officer gets a 422 naming the
    field and the values it accepts."""
    async with AsyncSessionLocal() as session:
        officer_email = (
            await session.execute(
                text(
                    "SELECT email FROM users WHERE role = 'field_officer' AND is_active = true "
                    "AND is_deleted = false ORDER BY created_at LIMIT 1"
                )
            )
        ).scalar()
        product_id = (
            await session.execute(text("SELECT id FROM products WHERE is_active = true LIMIT 1"))
        ).scalar()
    if not (officer_email and product_id):
        pytest.skip("Seeded officer/product not available")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post(
            "/api/v1/auth/login", json={"email": officer_email, "password": "Password123!"}
        )
        if login.status_code != 200:
            pytest.skip("Seeded login unavailable")
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        payload = _visit_payload(product_id, 1, "Bad Purpose Farmer")
        payload["visit_purpose"] = "demo"  # not in the allowed set
        resp = await client.post(
            "/api/v1/visits/daily-tracker/submit", headers=headers, json=payload
        )
        assert resp.status_code == 422, f"expected a validation error, got {resp.status_code}"
        assert any(
            err.get("loc", [])[-1:] == ["visit_purpose"] for err in resp.json().get("detail", [])
        ), resp.text


@pytest.mark.asyncio
async def test_admin_ledger_without_a_filter_shows_everyone() -> None:
    """The Stock History screen calls /stock/ledger with no officer_id.

    That case used to fall back to `current_user.user_id`, so an admin
    asking for the whole history was silently asking for their own.
    Admins hold no stock, so the answer was always an empty list and the
    History tab was permanently blank - the movement audit trail could
    not be reached from the UI at all.
    """
    async with AsyncSessionLocal() as session:
        officer = (
            await session.execute(
                text(
                    "SELECT id, email FROM users WHERE role IN ('field_officer','sales_officer') "
                    "AND is_active = true AND is_deleted = false ORDER BY created_at LIMIT 1"
                )
            )
        ).first()
        admin_email = (
            await session.execute(
                text(
                    "SELECT email FROM users WHERE role = 'admin' AND is_active = true "
                    "AND is_deleted = false ORDER BY created_at LIMIT 1"
                )
            )
        ).scalar()
        product_id = (
            await session.execute(text("SELECT id FROM products WHERE is_active = true LIMIT 1"))
        ).scalar()
    if not (officer and admin_email and product_id):
        pytest.skip("Seeded officer/admin/product not available")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        admin = await client.post(
            "/api/v1/auth/login", json={"email": admin_email, "password": "Password123!"}
        )
        if admin.status_code != 200:
            pytest.skip("Seeded admin login unavailable")
        A = {"Authorization": f"Bearer {admin.json()['access_token']}"}

        issued = await client.post(
            "/api/v1/stock/allocations",
            headers=A,
            json={
                "allocations": [
                    {"officer_id": str(officer.id), "product_id": str(product_id), "quantity": 7}
                ]
            },
        )
        assert issued.status_code == 201, issued.text

        history = await client.get("/api/v1/stock/ledger?limit=50", headers=A)
        assert history.status_code == 200, history.text
        rows = history.json()
        assert rows, "admin history came back empty; the officer filter defaulted to the admin again"
        assert any(r["qty_delta"] == 7 for r in rows), rows
        assert all(r.get("officer_name") for r in rows), "rows must name the officer"

    async with AsyncSessionLocal() as session:
        await session.execute(
            text("DELETE FROM stock_ledger WHERE officer_id = :o AND product_id = :p AND qty_delta = 7"),
            {"o": officer.id, "p": product_id},
        )
        await session.commit()


@pytest.mark.asyncio
async def test_an_officer_cannot_read_another_officers_ledger() -> None:
    """Widening the admin case must not widen the officer case."""
    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                text(
                    "SELECT id, email FROM users WHERE role IN ('field_officer','sales_officer') "
                    "AND is_active = true AND is_deleted = false ORDER BY created_at LIMIT 2"
                )
            )
        ).all()
    if len(rows) < 2:
        pytest.skip("Need two seeded officers")
    me, other = rows[0], rows[1]

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post(
            "/api/v1/auth/login", json={"email": me.email, "password": "Password123!"}
        )
        if login.status_code != 200:
            pytest.skip("Seeded officer login unavailable")
        H = {"Authorization": f"Bearer {login.json()['access_token']}"}

        resp = await client.get(f"/api/v1/stock/ledger?officer_id={other.id}&limit=50", headers=H)
        assert resp.status_code == 200, resp.text
        for row in resp.json():
            assert row["officer_name"] != str(other.id), row
        # Nothing returned may belong to the other officer.
        async with AsyncSessionLocal() as session:
            other_name = (
                await session.execute(
                    text("SELECT full_name FROM users WHERE id = :i"), {"i": other.id}
                )
            ).scalar()
        assert all(r["officer_name"] != other_name for r in resp.json()), (
            "an officer read another officer's stock movements"
        )
