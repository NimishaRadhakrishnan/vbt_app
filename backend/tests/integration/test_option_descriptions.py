"""
"Option requires a description" rule.

Guards the audit finding that prompted this work: several forms let an
officer pick "Other" with nowhere for the explanation to go, losing it
silently. The rule is driven by
enum_field_options.requires_description - NOT by value == 'other' - so
admin-created options are covered too.

Runs against a real Postgres.
"""

from __future__ import annotations

import asyncio
import logging
import os

import pytest
from sqlalchemy import create_engine, text

logging.disable(logging.CRITICAL)

DB_URL = (
    f"postgresql+psycopg2://{os.getenv('POSTGRES_USER','vbt')}:{os.getenv('POSTGRES_PASSWORD','vbt')}"
    f"@{os.getenv('POSTGRES_HOST','127.0.0.1')}:{os.getenv('POSTGRES_PORT','5433')}/{os.getenv('POSTGRES_DB','vbt')}"
)

FIELD = "test_option_field"


@pytest.fixture(scope="module")
def engine():
    return create_engine(DB_URL)


@pytest.fixture(autouse=True)
def _dispose_app_engine():
    """The app's async engine caches an asyncpg pool bound to the first
    event loop that used it. Other modules in this suite create their
    own loops, so without disposing around each test these pass alone
    but fail in a full run ("attached to a different loop"). Harness
    concern only - production runs a single long-lived loop."""
    import asyncio as _a

    from app.infrastructure.database.session import engine as app_engine

    def _d():
        try:
            _a.run(app_engine.dispose())
        except Exception:
            pass

    _d()
    yield
    _d()


@pytest.fixture(autouse=True)
def seed_options(engine):
    """Two ordinary options, one flagged 'other', and one ADMIN-CREATED
    option with a different name - the case a hardcoded 'other' check
    would miss."""
    with engine.begin() as c:
        c.execute(text("DELETE FROM enum_field_options WHERE field_name = :f").bindparams(f=FIELD))
        for value, label, req in (
            ("normal", "Normal", False),
            ("other", "Other", True),
            ("miscellaneous", "Miscellaneous", True),   # admin-created
        ):
            c.execute(
                text("""INSERT INTO enum_field_options
                        (id, field_name, value, label, display_order, requires_description)
                        VALUES (gen_random_uuid(), :f, :v, :l, 10, :r)""")
                .bindparams(f=FIELD, v=value, l=label, r=req)
            )
    yield
    with engine.begin() as c:
        c.execute(text("DELETE FROM enum_field_options WHERE field_name = :f").bindparams(f=FIELD))


async def _dispose():
    from app.infrastructure.database.session import engine as app_engine
    await app_engine.dispose()


def _run(coro_fn):
    """Each test gets its own loop; dispose after so the cached asyncpg
    pool is not reused across loops."""
    async def wrapper():
        try:
            return await coro_fn()
        finally:
            await _dispose()
    return asyncio.run(wrapper())


def _session():
    from app.infrastructure.database.session import AsyncSessionLocal
    return AsyncSessionLocal()


# --- the flag itself ---

def test_option_flagged_requires_description():
    from app.application.services.option_description_service import option_requires_description

    async def go():
        async with _session() as s:
            return await option_requires_description(s, FIELD, "other")
    assert _run(go) is True


def test_admin_created_option_is_also_recognised():
    """The whole reason for the flag: 'miscellaneous' is not 'other',
    but an admin marked it as needing a description."""
    from app.application.services.option_description_service import option_requires_description

    async def go():
        async with _session() as s:
            return await option_requires_description(s, FIELD, "miscellaneous")
    assert _run(go) is True


def test_ordinary_option_does_not_require_description():
    from app.application.services.option_description_service import option_requires_description

    async def go():
        async with _session() as s:
            return await option_requires_description(s, FIELD, "normal")
    assert _run(go) is False


# --- single-select validation ---

def test_missing_description_is_rejected():
    from fastapi import HTTPException

    from app.application.services.option_description_service import validate_option_description

    async def go():
        async with _session() as s:
            await validate_option_description(s, FIELD, "other", None)
    with pytest.raises(HTTPException) as e:
        _run(go)
    assert e.value.status_code == 400
    assert "describe" in e.value.detail.lower()


def test_whitespace_only_description_is_rejected():
    """A space is not an explanation - accepting it would let the
    frontend rule be bypassed trivially."""
    from fastapi import HTTPException

    from app.application.services.option_description_service import validate_option_description

    async def go():
        async with _session() as s:
            await validate_option_description(s, FIELD, "other", "   ")
    with pytest.raises(HTTPException):
        _run(go)


def test_valid_description_is_accepted():
    from app.application.services.option_description_service import validate_option_description

    async def go():
        async with _session() as s:
            await validate_option_description(s, FIELD, "other", "Storm damage")
            return True
    assert _run(go) is True


def test_non_requiring_option_never_blocks():
    """An ordinary option with no description must pass, and must
    also pass if a stale description is still attached."""
    from app.application.services.option_description_service import validate_option_description

    async def go():
        async with _session() as s:
            await validate_option_description(s, FIELD, "normal", None)
            await validate_option_description(s, FIELD, "normal", "leftover text")
            return True
    assert _run(go) is True


# --- multi-select validation ---

def test_multi_select_requires_description_when_flagged_option_present():
    from fastapi import HTTPException

    from app.application.services.option_description_service import (
        validate_multi_option_descriptions,
    )

    async def go():
        async with _session() as s:
            await validate_multi_option_descriptions(s, FIELD, ["normal", "other"], None)
    with pytest.raises(HTTPException):
        _run(go)


def test_multi_select_passes_without_flagged_option():
    from app.application.services.option_description_service import (
        validate_multi_option_descriptions,
    )

    async def go():
        async with _session() as s:
            await validate_multi_option_descriptions(s, FIELD, ["normal"], None)
            return True
    assert _run(go) is True


def test_multi_select_passes_with_description():
    from app.application.services.option_description_service import (
        validate_multi_option_descriptions,
    )

    async def go():
        async with _session() as s:
            await validate_multi_option_descriptions(s, FIELD, ["normal", "other"], "Root rot")
            return True
    assert _run(go) is True


def test_empty_multi_select_is_not_blocked():
    from app.application.services.option_description_service import (
        validate_multi_option_descriptions,
    )

    async def go():
        async with _session() as s:
            await validate_multi_option_descriptions(s, FIELD, [], None)
            return True
    assert _run(go) is True


# --- storage normalisation (the "switching away clears it" rule) ---

def test_description_cleared_when_option_does_not_require_it():
    """Server-side half of "clear the value when the user switches
    away" - so a description typed and then abandoned is never stored
    against an option it does not belong to."""
    from app.application.services.option_description_service import clear_if_not_required
    assert clear_if_not_required(False, "abandoned text") is None


def test_description_trimmed_when_required():
    from app.application.services.option_description_service import clear_if_not_required
    assert clear_if_not_required(True, "  Wind damage  ") == "Wind damage"


def test_existing_other_options_were_backfilled(engine):
    """Migration 202608260019 backfills existing 'other' values so
    current behaviour is preserved without admin intervention."""
    with engine.begin() as c:
        rows = c.execute(
            text("""SELECT field_name FROM enum_field_options
                    WHERE lower(value) = 'other' AND requires_description = false""")
        ).fetchall()
    assert rows == [], f"existing 'other' options not flagged: {rows}"
