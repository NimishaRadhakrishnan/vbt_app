"""Business-rule refusals must reach the user, not surface as 500s.

Sixteen rules across the application layer were raised as bare
``ValueError``. No handler mapped that type, so every one of them fell
through to the catch-all and the user was shown:

    "An unexpected error occurred. Our team has been notified."

The messages behind them were already written for a person - "You have
already checked in for today.", "Weekly plan ... cannot be modified.",
"A farmer with phone number ... is already registered." - and none of
them ever arrived. An officer who taps check-in twice, or whose first
request succeeded while the reply was lost on a rural connection, saw a
crash instead of an explanation.

They now raise domain exceptions the error handler maps: 409 where the
request would duplicate something, 400 otherwise.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.infrastructure.database.session import AsyncSessionLocal
from app.main import app


@pytest.mark.asyncio
async def test_duplicate_check_in_is_409_with_the_real_message() -> None:
    async with AsyncSessionLocal() as session:
        row = (
            await session.execute(
                text(
                    "SELECT email, device_id FROM users WHERE role = 'field_officer' "
                    "AND is_active = true AND is_deleted = false AND device_id IS NOT NULL "
                    "ORDER BY created_at LIMIT 1"
                )
            )
        ).first()
    if not row:
        pytest.skip("No seeded field officer with a device id")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post(
            "/api/v1/auth/login", json={"email": row.email, "password": "Password123!"}
        )
        if login.status_code != 200:
            pytest.skip("Seeded login unavailable")
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        # Accept the location disclosure first. Check-in is gated on it, and on
        # a freshly seeded database nobody has accepted it - without this the
        # request is refused with 403 before the duplicate rule is ever
        # reached, and this test passes or fails depending on whether someone
        # happened to accept consent earlier in the session.
        disclosure = await client.get("/api/v1/consent/location", headers=headers)
        version = (disclosure.json() or {}).get("version") or 1
        await client.post(
            "/api/v1/consent/location",
            headers=headers,
            json={"version": version, "source": "server"},
        )

        body = {"latitude": 11.665, "longitude": 78.147, "device_id": row.device_id}

        first = await client.post("/api/v1/attendance/check-in", headers=headers, json=body)
        second = await client.post("/api/v1/attendance/check-in", headers=headers, json=body)
        assert 403 not in (first.status_code, second.status_code), (
            "check-in was refused before the duplicate rule could be reached: "
            f"{first.status_code}/{second.status_code} — consent setup above did not take"
        )

        # Whichever of the two hits an existing check-in must explain itself.
        refused = second if second.status_code >= 400 else first
        assert refused.status_code == 409, (
            f"a second check-in returned {refused.status_code}; a business rule is "
            "reaching the user as a server fault again"
        )
        payload = refused.json()
        assert "already checked in" in payload.get("message", "").lower(), payload
        assert "unexpected error" not in payload.get("message", "").lower(), payload


def test_no_bare_value_errors_left_in_the_application_layer() -> None:
    """Source guard.

    A bare ValueError out of a use case has no handler, so it becomes a
    500 with a generic message and the real reason is lost. Raise a
    DomainException subclass instead - the handler maps those to a status
    and passes the message through.
    """
    import pathlib
    import re

    app_dir = pathlib.Path(__file__).resolve().parents[2] / "app" / "application"
    offenders: list[str] = []
    pattern = re.compile(r"raise\s+ValueError\s*\(")

    for path in sorted(app_dir.rglob("*.py")):
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if pattern.search(line):
                rel = path.relative_to(app_dir.parent.parent)
                offenders.append(f"{rel}:{lineno}: {line.strip()}")

    assert not offenders, (
        "Bare ValueError in the application layer reaches the user as a 500 with "
        '"An unexpected error occurred". Raise BusinessRuleViolationException or '
        "ConflictException instead:\n" + "\n".join(offenders)
    )
