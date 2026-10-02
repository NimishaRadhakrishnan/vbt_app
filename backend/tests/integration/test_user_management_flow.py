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
async def test_admin_self_deactivation_prevented() -> None:
    if not await _database_reachable():
        pytest.skip("Database not reachable in this environment.")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Login as the seeded admin
        login_response = await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@vishakan.com", "password": "Password123!"},
        )
        assert login_response.status_code == 200
        tokens = login_response.json()

        # 2. Get admin user details to find admin ID
        me_response = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        assert me_response.status_code == 200
        admin_id = me_response.json()["id"]

        # 3. Try to deactivate self
        deactivate_response = await client.post(
            f"/api/v1/users/{admin_id}/status",
            json={"is_active": False},
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        assert deactivate_response.status_code == 400
        assert "cannot deactivate their own account" in deactivate_response.json()["detail"]
