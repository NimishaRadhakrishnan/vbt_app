"""
Emergency override: suspends day-closure enforcement for a scoped set of
officers over a fixed window.

This is the escape hatch for live 17:30 logout enforcement, so the
failure modes matter more than usual:
  - too permissive -> compliance silently off for everyone
  - too strict     -> officers locked out during a real incident
Both directions are tested.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid

import pytest
from sqlalchemy import create_engine, text

logging.disable(logging.CRITICAL)

DB_URL = (
    f"postgresql+psycopg2://{os.getenv('POSTGRES_USER','vbt')}:{os.getenv('POSTGRES_PASSWORD','vbt')}"
    f"@{os.getenv('POSTGRES_HOST','127.0.0.1')}:{os.getenv('POSTGRES_PORT','5433')}/{os.getenv('POSTGRES_DB','vbt')}"
)

FO = uuid.UUID("abcdabcd-0000-0000-0000-000000000001")
SO = uuid.UUID("abcdabcd-0000-0000-0000-000000000002")


@pytest.fixture(scope="module")
def engine():
    return create_engine(DB_URL)


@pytest.fixture(autouse=True)
def setup(engine):
    with engine.begin() as c:
        c.execute(text("DELETE FROM emergency_overrides WHERE reason LIKE 'TEST %'"))
        for u in (FO, SO):
            c.execute(text("DELETE FROM user_territories WHERE user_id=:u").bindparams(u=u))
            c.execute(text("DELETE FROM attendance WHERE user_id = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM visits WHERE user_id = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM tasks WHERE assigned_to = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM day_closures WHERE officer_id = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM crop_issues WHERE user_id = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM leave_requests WHERE officer_id = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM audit_logs WHERE user_id = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM officer_locations WHERE officer_id = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM device_registry WHERE user_id = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM user_territories WHERE user_id = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM weekly_plans WHERE user_id = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM notifications WHERE user_id = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM expenses WHERE user_id = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM enquiries WHERE reported_by = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM daily_work_reports WHERE user_id = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM personal_bests WHERE user_id = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM user_badges WHERE user_id = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM file_uploads WHERE uploaded_by = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM visit_drafts WHERE officer_id = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM officer_product_stock WHERE officer_id = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM officer_stock_adjustments WHERE officer_id = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM officer_monthly_targets WHERE officer_id = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM location_consent_acceptances WHERE user_id = :uid").bindparams(uid=u))
            c.execute(text("DELETE FROM users WHERE id = :uid").bindparams(uid=u))
        c.execute(text("""INSERT INTO users (id,email,full_name,role,hashed_password,is_active)
                          VALUES (:i,'eo_fo@t.local','EO FO','field_officer','x',true)""").bindparams(i=FO))
        c.execute(text("""INSERT INTO users (id,email,full_name,role,hashed_password,is_active)
                          VALUES (:i,'eo_so@t.local','EO SO','sales_officer','x',true)""").bindparams(i=SO))
    yield
    with engine.begin() as c:
        c.execute(text("DELETE FROM emergency_overrides WHERE reason LIKE 'TEST %'"))
        for u in (FO, SO):
            c.execute(text("DELETE FROM user_territories WHERE user_id=:u").bindparams(u=u))


def _declare(engine, reason, hours_from=-1, hours_to=1, role=None, district=None, active=True):
    oid = uuid.uuid4()
    with engine.begin() as c:
        c.execute(
            text("""INSERT INTO emergency_overrides
                    (id, reason, starts_at, ends_at, scope_role, scope_district, is_active)
                    VALUES (:id,:r, now() + (:hf || ' hours')::interval,
                            now() + (:ht || ' hours')::interval, :role, :dist, :act)""")
            .bindparams(id=oid, r=reason, hf=str(hours_from), ht=str(hours_to),
                        role=role, dist=district, act=active)
        )
    return oid


def _check(officer_id, role):
    from app.application.services.emergency_override_service import active_override_for
    from app.infrastructure.database.session import AsyncSessionLocal
    from app.infrastructure.database.session import engine as app_engine

    async def go():
        try:
            async with AsyncSessionLocal() as s:
                return await active_override_for(s, officer_id, role)
        finally:
            await app_engine.dispose()
    return asyncio.run(go())


# --- basic window behaviour ---

def test_no_override_returns_none(engine):
    assert _check(FO, "field_officer") is None


def test_active_override_covers_all_officers_by_default(engine):
    _declare(engine, "TEST cyclone")
    assert _check(FO, "field_officer") is not None
    assert _check(SO, "sales_officer") is not None


def test_future_override_is_not_yet_active(engine):
    _declare(engine, "TEST scheduled", hours_from=2, hours_to=4)
    assert _check(FO, "field_officer") is None, "an override starting later must not apply now"


def test_expired_override_no_longer_applies(engine):
    _declare(engine, "TEST expired", hours_from=-5, hours_to=-2)
    assert _check(FO, "field_officer") is None


def test_manually_cancelled_override_stops_immediately(engine):
    """The kill switch must not wait for ends_at - that is the whole
    point of having it alongside the window."""
    _declare(engine, "TEST cancelled", active=False)
    assert _check(FO, "field_officer") is None


# --- scope targeting ---

def test_role_scoped_override_applies_only_to_that_role(engine):
    _declare(engine, "TEST field only", role="field_officer")
    assert _check(FO, "field_officer") is not None
    assert _check(SO, "sales_officer") is None, "a role-scoped override must not leak to other roles"


def test_district_scoped_override_applies_only_to_that_district(engine):
    """District is resolved through user_territories -> territories,
    since `users` has no district column."""
    tid = uuid.uuid4()
    with engine.begin() as c:
        c.execute(text("""INSERT INTO territories (id,name,district)
                          VALUES (:t,'EO Test Territory','Dindigul')""").bindparams(t=tid))
        c.execute(text("""INSERT INTO user_territories (id,user_id,territory_id)
                          VALUES (gen_random_uuid(),:u,:t)""").bindparams(u=FO, t=tid))

    _declare(engine, "TEST dindigul flood", district="Dindigul")
    try:
        assert _check(FO, "field_officer") is not None, "officer in the district must be covered"
        assert _check(SO, "sales_officer") is None, "officer with no matching territory must not be"
    finally:
        with engine.begin() as c:
            c.execute(text("DELETE FROM user_territories WHERE territory_id=:t").bindparams(t=tid))
            c.execute(text("DELETE FROM territories WHERE id=:t").bindparams(t=tid))


def test_district_match_is_case_insensitive(engine):
    tid = uuid.uuid4()
    with engine.begin() as c:
        c.execute(text("""INSERT INTO territories (id,name,district)
                          VALUES (:t,'EO Case','Salem')""").bindparams(t=tid))
        c.execute(text("""INSERT INTO user_territories (id,user_id,territory_id)
                          VALUES (gen_random_uuid(),:u,:t)""").bindparams(u=FO, t=tid))
    _declare(engine, "TEST case", district="salem")
    try:
        assert _check(FO, "field_officer") is not None, "district match must not be case sensitive"
    finally:
        with engine.begin() as c:
            c.execute(text("DELETE FROM user_territories WHERE territory_id=:t").bindparams(t=tid))
            c.execute(text("DELETE FROM territories WHERE id=:t").bindparams(t=tid))


# --- data integrity ---

def test_end_before_start_is_rejected(engine):
    import sqlalchemy as sa
    with pytest.raises(sa.exc.IntegrityError):
        _declare(engine, "TEST backwards", hours_from=2, hours_to=1)


def test_empty_reason_is_rejected(engine):
    """An override with no stated cause is not auditable."""
    import sqlalchemy as sa
    with pytest.raises(sa.exc.IntegrityError):
        _declare(engine, "   ")


def test_override_payload_carries_reason_for_display(engine):
    _declare(engine, "TEST regional outage")
    got = _check(FO, "field_officer")
    assert got is not None
    assert got["reason"] == "TEST regional outage"
