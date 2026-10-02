"""Every endpoint the admin dashboard calls on load must not 500.

`GET /attendance/roster-status` shipped broken: a fix for the UTC
day-boundary bug added `from app.domain.services.time_utils import ...`
inside the function body. That module does not exist, so the import only
failed when a request actually arrived. Nothing imported the router at
test time in a way that caught it, the suite stayed green, and the
dashboard showed a CORS error in the browser instead of the real 500.

A 401/403/404 here is fine - that is the app answering. Anything 5xx is
the app falling over, which is what this guards.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.infrastructure.database.session import AsyncSessionLocal
from app.main import app

# Read-only endpoints the dashboard hits on first paint.
DASHBOARD_GETS = [
    "/api/v1/attendance/roster-status",
    "/api/v1/day-closure/missing-today",
    "/api/v1/admin/users",
    "/api/v1/admin/products",
    "/api/v1/admin/daily-visits",
    "/api/v1/admin/audit-logs",
    "/api/v1/location/active",
    "/api/v1/notifications",
    "/api/v1/tasks",
    "/api/v1/plans",
    "/api/v1/issues",
    "/api/v1/enquiries",
    "/api/v1/leave",
    "/api/v1/holidays",
    "/api/v1/hr-policies",
    "/api/v1/stock/reconciliation",
    "/api/v1/admin/day-closure-config",
    "/api/v1/consent/disclosure",
]


@pytest.mark.asyncio
async def test_no_dashboard_endpoint_returns_5xx() -> None:
    async with AsyncSessionLocal() as session:
        res = await session.execute(
            text(
                "SELECT email FROM users WHERE role = 'admin' "
                "AND is_active = true AND is_deleted = false ORDER BY created_at LIMIT 1"
            )
        )
        email = res.scalar()
    if not email:
        pytest.skip("No seeded admin available")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post(
            "/api/v1/auth/login", json={"email": email, "password": "Password123!"}
        )
        if login.status_code != 200:
            pytest.skip(f"Admin login unavailable: {login.status_code}")
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        failures = []
        for path in DASHBOARD_GETS:
            resp = await client.get(path, headers=headers)
            if resp.status_code >= 500:
                failures.append(f"{path} -> {resp.status_code} {resp.text[:160]}")

        assert not failures, "Dashboard endpoints returning 5xx:\n" + "\n".join(failures)


def test_every_router_import_resolves() -> None:
    """Source guard for the defect that took roster-status down.

    Imports nested inside a function are legitimate - several routers use
    them to break an import cycle. The danger is that such an import is
    never executed until a request reaches that exact line, so a module
    path that does not exist sails through import-time checks and through
    any test that does not hit the branch.

    So this does not ban the pattern. It resolves every import target in
    every router, nested or not, and fails on the ones that point at
    nothing. `app.domain.services.time_utils` would have been caught here
    the moment it was written.
    """
    import ast
    import importlib.util
    import pathlib

    routers_dir = (
        pathlib.Path(__file__).resolve().parents[2]
        / "app" / "presentation" / "api" / "v1" / "routers"
    )
    unresolved: list[str] = []

    def _check(module_name: str | None, where: str) -> None:
        if not module_name or not module_name.startswith("app."):
            return  # third-party/stdlib already proven by the app booting
        try:
            if importlib.util.find_spec(module_name) is None:
                unresolved.append(f"{where}: no module named {module_name!r}")
        except (ImportError, ModuleNotFoundError, ValueError):
            unresolved.append(f"{where}: no module named {module_name!r}")

    for path in sorted(routers_dir.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.level == 0:
                _check(node.module, f"{path.name}:{node.lineno}")
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    _check(alias.name, f"{path.name}:{node.lineno}")

    assert not unresolved, (
        "Router imports that point at modules which do not exist. A nested one of "
        "these only fails when a request reaches it:\n" + "\n".join(unresolved)
    )
