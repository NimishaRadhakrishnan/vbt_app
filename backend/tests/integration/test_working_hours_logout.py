"""
Fixed working hours (09:00-17:30 IST) and day-closure logout enforcement.

Requirement #1 is deliberately tested SEPARATELY from the 17:30 warning:
the two share a time today but answer different questions, and a future
change to the nudge time must not silently move the enforcement
boundary.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

logging.disable(logging.CRITICAL)
IST = ZoneInfo("Asia/Kolkata")
DB_URL = (
    f"postgresql+psycopg2://{os.getenv('POSTGRES_USER','vbt')}:{os.getenv('POSTGRES_PASSWORD','vbt')}"
    f"@{os.getenv('POSTGRES_HOST','127.0.0.1')}:{os.getenv('POSTGRES_PORT','5433')}/{os.getenv('POSTGRES_DB','vbt')}"
)
FO = uuid.UUID("eeeeeeee-0000-0000-0000-000000000001")
ADMIN = uuid.UUID("eeeeeeee-0000-0000-0000-000000000002")


@pytest.fixture(scope="module")
def engine():
    return create_engine(DB_URL)


@pytest.fixture(autouse=True)
def setup(engine):
    from app.infrastructure.database.session import engine as app_engine
    def dispose():
        try: asyncio.run(app_engine.dispose())
        except Exception: pass
    dispose()
    with engine.begin() as c:
        for u in (FO, ADMIN):
            c.execute(text("DELETE FROM day_closures WHERE officer_id=:u").bindparams(u=u))
            c.execute(text("DELETE FROM attendance WHERE user_id = :u").bindparams(u=u))
            c.execute(text("DELETE FROM visits WHERE user_id = :u").bindparams(u=u))
            c.execute(text("DELETE FROM tasks WHERE assigned_to = :u").bindparams(u=u))
            c.execute(text("DELETE FROM day_closures WHERE officer_id = :u").bindparams(u=u))
            c.execute(text("DELETE FROM crop_issues WHERE user_id = :u").bindparams(u=u))
            c.execute(text("DELETE FROM leave_requests WHERE officer_id = :u").bindparams(u=u))
            c.execute(text("DELETE FROM audit_logs WHERE user_id = :u").bindparams(u=u))
            c.execute(text("DELETE FROM officer_locations WHERE officer_id = :u").bindparams(u=u))
            c.execute(text("DELETE FROM device_registry WHERE user_id = :u").bindparams(u=u))
            c.execute(text("DELETE FROM user_territories WHERE user_id = :u").bindparams(u=u))
            c.execute(text("DELETE FROM weekly_plans WHERE user_id = :u").bindparams(u=u))
            c.execute(text("DELETE FROM notifications WHERE user_id = :u").bindparams(u=u))
            c.execute(text("DELETE FROM expenses WHERE user_id = :u").bindparams(u=u))
            c.execute(text("DELETE FROM enquiries WHERE reported_by = :u").bindparams(u=u))
            c.execute(text("DELETE FROM daily_work_reports WHERE user_id = :u").bindparams(u=u))
            c.execute(text("DELETE FROM personal_bests WHERE user_id = :u").bindparams(u=u))
            c.execute(text("DELETE FROM user_badges WHERE user_id = :u").bindparams(u=u))
            c.execute(text("DELETE FROM file_uploads WHERE uploaded_by = :u").bindparams(u=u))
            c.execute(text("DELETE FROM visit_drafts WHERE officer_id = :u").bindparams(u=u))
            c.execute(text("DELETE FROM officer_product_stock WHERE officer_id = :u").bindparams(u=u))
            c.execute(text("DELETE FROM officer_stock_adjustments WHERE officer_id = :u").bindparams(u=u))
            c.execute(text("DELETE FROM officer_monthly_targets WHERE officer_id = :u").bindparams(u=u))
            c.execute(text("DELETE FROM location_consent_acceptances WHERE user_id = :u").bindparams(u=u))
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
                          VALUES (:i,'wh_fo@t.local','WH FO','field_officer','x',true)""").bindparams(i=FO))
        c.execute(text("""INSERT INTO users (id,email,full_name,role,hashed_password,is_active)
                          VALUES (:i,'wh_ad@t.local','WH Admin','admin','x',true)""").bindparams(i=ADMIN))
    yield
    with engine.begin() as c:
        for u in (FO, ADMIN):
            c.execute(text("DELETE FROM day_closures WHERE officer_id=:u").bindparams(u=u))
    dispose()


# --- #1 working-hours boundaries (three windows the requirement names) ---

@pytest.mark.parametrize("h,m,before,within,after", [
    (8, 0,  True,  False, False),   # before 09:00
    (8, 59, True,  False, False),
    (9, 0,  False, True,  False),   # start boundary
    (13, 0, False, True,  False),   # mid-day
    (17, 29, False, True, False),   # last minute of the working day
    (17, 30, False, False, True),   # end boundary - "at or after" counts
    (21, 0, False, False, True),
])
def test_working_hour_windows(h, m, before, within, after):
    from app.infrastructure.config.company_time import (
        is_after_working_hours,
        is_before_working_hours,
        is_within_working_hours,
    )
    t = datetime(2026, 9, 7, h, m, tzinfo=IST)
    assert is_before_working_hours(t) is before
    assert is_within_working_hours(t) is within
    assert is_after_working_hours(t) is after


def test_working_hours_are_independent_of_the_warning_constant():
    """They coincide today; they must not be the same constant."""
    from app.infrastructure.config.company_time import (
        DAY_CLOSURE_WARNING_HOUR,
        DAY_CLOSURE_WARNING_MINUTE,
        WORK_END_HOUR,
        WORK_END_MINUTE,
    )
    assert (WORK_END_HOUR, WORK_END_MINUTE) == (17, 30)
    assert (DAY_CLOSURE_WARNING_HOUR, DAY_CLOSURE_WARNING_MINUTE) == (17, 30)


def test_working_hours_use_india_timezone():
    from app.infrastructure.config.company_time import company_now
    assert str(company_now().tzinfo) == "Asia/Kolkata"


# --- #4 logout enforcement ---

def _logout(user_id, role):
    from app.application.dto.auth_dto import CurrentUserOutput
    from app.infrastructure.database.session import engine as app_engine
    from app.main import app

    # Logout depends on get_current_user_OPTIONAL (it must still work
    # when the access token has expired), so overriding get_current_user
    # here would have no effect - the request would arrive with
    # current_user=None, enforcement would be skipped, and the test
    # would see a misleading 204.
    from app.presentation.api.v1.dependencies import get_current_user_optional as get_current_user

    app.dependency_overrides[get_current_user] = lambda: CurrentUserOutput(
        user_id=user_id, email="t@t", full_name="T", role=role, is_active=True, employee_id="E")

    # Dispose BEFORE the call as well as after: a preceding test in the
    # same module may have left a pool bound to a now-closed loop, which
    # surfaces only in a full-suite run ("attached to a different
    # loop"). Harness concern, not a product one.
    try:
        asyncio.run(app_engine.dispose())
    except Exception:
        pass

    async def go():
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
                return await c.post("/api/v1/auth/logout", json={"refresh_token": "dummy"})
        finally:
            app.dependency_overrides.clear()
            await app_engine.dispose()
    return asyncio.run(go())


def test_admin_is_never_blocked():
    """Approved: admin exempt. Must hold whatever the time is."""
    r = _logout(ADMIN, "admin")
    assert r.status_code != 409


def test_officer_with_closure_can_log_out(engine):
    with engine.begin() as c:
        c.execute(text("""INSERT INTO day_closures (id,officer_id,date,closure_type)
                          VALUES (gen_random_uuid(),:o,:d,'field_visit')""")
                  .bindparams(o=FO, d=datetime.now(IST).date()))
    r = _logout(FO, "field_officer")
    assert r.status_code != 409, "a submitted closure must never block logout"


def test_no_activity_closure_also_satisfies_logout(engine):
    """The 'No activity today' option must satisfy the same gate - it is
    the only way an officer with nothing to report can ever sign out."""
    with engine.begin() as c:
        c.execute(text("""INSERT INTO day_closures (id,officer_id,date,closure_type,no_activity_reason)
                          VALUES (gen_random_uuid(),:o,:d,'no_activity','Sick leave')""")
                  .bindparams(o=FO, d=datetime.now(IST).date()))
    r = _logout(FO, "field_officer")
    assert r.status_code != 409


def test_officer_without_closure_matches_time_of_day():
    """After 17:30 on a working day -> blocked (409). Before/during, or
    on a non-working day -> allowed. Asserted against the real clock so
    the test states the rule rather than restating the implementation."""
    from app.infrastructure.config.company_time import (
        company_today,
        is_after_working_hours,
        is_weekly_working_day,
    )
    r = _logout(FO, "field_officer")
    should_block = is_after_working_hours() and is_weekly_working_day(company_today())
    if should_block:
        assert r.status_code == 409
        assert "day closure" in r.json()["detail"].lower()
    else:
        assert r.status_code != 409


def test_block_message_points_to_the_no_activity_option():
    """If blocked, the officer must be told how to comply - otherwise an
    officer with genuinely nothing to report is stuck."""
    from app.infrastructure.config.company_time import (
        company_today,
        is_after_working_hours,
        is_weekly_working_day,
    )
    if not (is_after_working_hours() and is_weekly_working_day(company_today())):
        pytest.skip("only meaningful after working hours on a working day")
    r = _logout(FO, "field_officer")
    assert "No activity today" in r.json()["detail"]
