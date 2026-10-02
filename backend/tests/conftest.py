from __future__ import annotations

import os

# Settings are validated at import time (required fields: jwt_secret_key,
# postgres_password), so test-only defaults must exist before any app module
# is imported. This runs once per test session via pytest's collection of
# conftest.py before test modules.
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only")
os.environ.setdefault("POSTGRES_PASSWORD", "test-password")
os.environ.setdefault("ENVIRONMENT", "test")


# --- Async connection-pool isolation between tests ---
#
# The app's async SQLAlchemy engine and the async Redis client each
# cache a connection pool bound to whichever event loop first used
# them. Tests that call the ASGI app via asyncio.run() get a NEW loop
# each time, so the second such test inherits a pool tied to a closed
# loop and fails with "attached to a different loop" / "Event loop is
# closed".
#
# The symptom is nasty because it is order-dependent: the tests pass
# individually and fail in a full run, which reads as flakiness rather
# than a harness defect.
#
# Disposing both around every test makes each one self-contained. This
# is a TEST concern only - production runs a single long-lived loop and
# benefits from pool reuse, so nothing here changes app behaviour.
import asyncio as _asyncio

import pytest as _pytest


import pytest_asyncio

async def _dispose_async_pools() -> None:
    try:
        from app.infrastructure.database.session import engine as _engine
        await _engine.dispose()
    except Exception:
        pass
    try:
        from app.infrastructure.cache import redis_client as _rc
        await _rc._pool.disconnect()
    except Exception:
        pass


@pytest_asyncio.fixture(autouse=True, loop_scope="function")
async def _isolate_async_pools():
    await _dispose_async_pools()
    yield
    await _dispose_async_pools()


# --- Async DB session for tests that exercise repository/service code ---
#
# The existing suite drives the app through HTTP. Some logic - the stock
# ledger's balance arithmetic and its database constraints in particular
# - is better tested directly against a session, because the thing under
# test is an invariant of the data, not the shape of a response.
#
# Function-scoped and rolled back at teardown so tests stay independent
# of each other and of the seeded demo data.
@pytest_asyncio.fixture(loop_scope="function")
async def db_session():
    from app.infrastructure.database.session import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.rollback()
