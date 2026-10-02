"""
17:30 day-closure warning: threshold, working days, holidays, status.

Covers the eight scenarios approved for this task. Runs against a REAL
Postgres and the REAL FastAPI app - the holiday and closure lookups are
SQL, and the timezone logic is exactly the kind of thing a mock would
happily fake.

Scope note: this task is the WARNING only. Nothing here asserts that
logout is blocked, because logout blocking was explicitly deferred.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import date, datetime
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

FO_ID = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000001")
ADMIN_ID = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000002")


@pytest.fixture(scope="module")
def engine():
    return create_engine(DB_URL)


@pytest.fixture(autouse=True)
def _dispose_app_engine():
    """The app's async engine caches an asyncpg pool bound to whichever
    event loop first used it. Other test modules in this suite create
    their own loops, so by the time these tests run the pool can be
    bound to a dead one - producing "attached to a different loop"
    failures that appear only in a full-suite run and pass in isolation.

    Disposing before AND after each test makes these tests independent
    of whatever ran before them. This is a test-harness concern only;
    production runs a single long-lived loop.
    """
    import asyncio as _asyncio

    from app.infrastructure.database.session import engine as app_engine

    def _dispose():
        try:
            _asyncio.run(app_engine.dispose())
        except Exception:
            pass

    _dispose()
    yield
    _dispose()


@pytest.fixture(autouse=True)
def clean(engine):
    with engine.begin() as c:
        for uid in (FO_ID, ADMIN_ID):
            c.execute(text("DELETE FROM day_closures WHERE officer_id=:u").bindparams(u=uid))
            c.execute(text("DELETE FROM attendance WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM visits WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM tasks WHERE assigned_to = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM day_closures WHERE officer_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM crop_issues WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM leave_requests WHERE officer_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM audit_logs WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM officer_locations WHERE officer_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM device_registry WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM user_territories WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM weekly_plans WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM notifications WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM expenses WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM enquiries WHERE reported_by = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM daily_work_reports WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM personal_bests WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM user_badges WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM file_uploads WHERE uploaded_by = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM visit_drafts WHERE officer_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM officer_product_stock WHERE officer_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM officer_stock_adjustments WHERE officer_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM officer_monthly_targets WHERE officer_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM location_consent_acceptances WHERE user_id = :u").bindparams(u=uid))
            c.execute(text("DELETE FROM attendance WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM visits WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM tasks WHERE assigned_to = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM day_closures WHERE officer_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM crop_issues WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM leave_requests WHERE officer_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM audit_logs WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM officer_locations WHERE officer_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM device_registry WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM user_territories WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM weekly_plans WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM notifications WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM expenses WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM enquiries WHERE reported_by = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM daily_work_reports WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM personal_bests WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM user_badges WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM file_uploads WHERE uploaded_by = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM visit_drafts WHERE officer_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM officer_product_stock WHERE officer_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM officer_stock_adjustments WHERE officer_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM officer_monthly_targets WHERE officer_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM location_consent_acceptances WHERE user_id = :uid").bindparams(uid=uid))
            c.execute(text("DELETE FROM users WHERE id = :uid").bindparams(uid=uid))
        c.execute(text("DELETE FROM holiday_calendar WHERE description='TEST HOLIDAY'"))
        for uid, role, email in (
            (FO_ID, "field_officer", "warnfo@test.local"),
            (ADMIN_ID, "admin", "warnadmin@test.local"),
        ):
            c.execute(
                text("""INSERT INTO users (id,email,full_name,role,hashed_password,is_active)
                        VALUES (:i,:e,'Warn Test',:r,'x',true)""").bindparams(i=uid, e=email, r=role)
            )
    yield
    with engine.begin() as c:
        c.execute(text("DELETE FROM holiday_calendar WHERE description='TEST HOLIDAY'"))


def _client(user_id, role):
    """Real ASGI client with auth overridden - exercises the actual
    endpoint, SQL and all, not a stub."""
    import sys
    sys.path.insert(0, ".")
    from app.application.dto.auth_dto import CurrentUserOutput
    from app.main import app
    from app.presentation.api.v1.dependencies import get_current_user

    app.dependency_overrides[get_current_user] = lambda: CurrentUserOutput(
        user_id=user_id, email="t@t", full_name="T", role=role, is_active=True, employee_id="E1"
    )
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def _call_and_dispose(user_id, role):
    """Each test runs in its own asyncio.run() loop, but the app's async
    engine caches a connection pool bound to whichever loop created it.
    Reusing it across loops raises "attached to a different loop" - a
    test-harness problem, not a product one, so the engine is disposed
    at the end of every call to keep tests independent.
    """
    from app.infrastructure.database.session import engine as app_engine
    try:
        async with _client(user_id, role) as c:
            r = await c.get("/api/v1/day-closure/warning-status")
            assert r.status_code == 200, r.text
            return r.json()
    finally:
        from app.main import app
        app.dependency_overrides.clear()
        await app_engine.dispose()


def _warning_status(user_id=FO_ID, role="field_officer"):
    return asyncio.run(_call_and_dispose(user_id, role))


# --- pure threshold logic (no DB dependency, exact boundary) ---

def test_before_1730_no_warning_due_to_time():
    from app.infrastructure.config.company_time import warning_threshold_passed
    assert warning_threshold_passed(datetime(2026, 9, 7, 17, 29, tzinfo=IST)) is False
    assert warning_threshold_passed(datetime(2026, 9, 7, 9, 0, tzinfo=IST)) is False


def test_at_and_after_1730_threshold_passed():
    from app.infrastructure.config.company_time import warning_threshold_passed
    # Exactly 17:30 must count as passed - an off-by-one here means the
    # warning never fires for anyone checking at precisely 17:30.
    assert warning_threshold_passed(datetime(2026, 9, 7, 17, 30, tzinfo=IST)) is True
    assert warning_threshold_passed(datetime(2026, 9, 7, 21, 0, tzinfo=IST)) is True


def test_sunday_is_not_a_working_day():
    from app.infrastructure.config.company_time import is_weekly_working_day
    assert is_weekly_working_day(date(2026, 9, 6)) is False   # Sunday
    assert is_weekly_working_day(date(2026, 9, 5)) is True    # Saturday IS working
    assert is_weekly_working_day(date(2026, 9, 7)) is True    # Monday


def test_india_timezone_boundary_uses_company_date():
    """00:00-05:29 IST is still the PREVIOUS day in UTC. The warning must
    key off the Indian date, or officers get warned for the wrong day."""
    from app.infrastructure.config.company_time import company_today
    small_hours = datetime(2026, 9, 7, 2, 0, tzinfo=IST)
    assert small_hours.astimezone(ZoneInfo("UTC")).date() == date(2026, 9, 6)
    assert small_hours.date() == date(2026, 9, 7)
    assert company_today() == datetime.now(IST).date()


# --- endpoint behaviour against the live database ---

def test_endpoint_reports_required_for_field_officer():
    data = _warning_status()
    assert data["required"] is True
    assert data["company_date"] == datetime.now(IST).date().isoformat()


def test_admin_is_not_required_and_never_warned():
    data = _warning_status(ADMIN_ID, "admin")
    assert data["required"] is False
    assert data["warning_due"] is False


def test_submitted_closure_suppresses_warning(engine):
    with engine.begin() as c:
        c.execute(
            text("""INSERT INTO day_closures (id,officer_id,date,closure_type)
                    VALUES (gen_random_uuid(),:o,:d,'field_visit')""")
            .bindparams(o=FO_ID, d=datetime.now(IST).date())
        )
    data = _warning_status()
    assert data["submitted"] is True
    assert data["warning_due"] is False, "a submitted closure must never warn"


def test_missing_closure_warns_only_when_working_day_and_past_threshold():
    from app.infrastructure.config.company_time import (
        is_weekly_working_day,
        warning_threshold_passed,
    )
    data = _warning_status()
    assert data["submitted"] is False
    expected = is_weekly_working_day(datetime.now(IST).date()) and warning_threshold_passed()
    assert data["warning_due"] is expected


def test_holiday_suppresses_warning(engine):
    """A company holiday added by an admin must stop the warning, even on
    a Mon-Sat day past 17:30."""
    today = datetime.now(IST).date()
    with engine.begin() as c:
        c.execute(
            text("""INSERT INTO holiday_calendar (id,date,description,is_national)
                    VALUES (gen_random_uuid(),:d,'TEST HOLIDAY',false)
                    ON CONFLICT DO NOTHING""").bindparams(d=today)
        )
    data = _warning_status()
    assert data["is_working_day"] is False
    assert data["warning_due"] is False, "no warning on a company holiday"


def test_response_contains_all_seven_required_fields():
    data = _warning_status()
    for field in ("required", "is_working_day", "company_date",
                  "current_time", "submitted", "queued", "warning_due"):
        assert field in data, f"missing required field: {field}"


def test_queued_is_false_server_side():
    """The server can never see a queued item - it is by definition not
    yet delivered. Clients overlay their own local queue state."""
    data = _warning_status()
    assert data["queued"] is False


# --- "No activity today" closure (approved requirement) ---

NA_ID = uuid.UUID("cccccccc-0000-0000-0000-000000000009")


@pytest.fixture
def na_officer(engine):
    with engine.begin() as c:
        c.execute(text("DELETE FROM day_closures WHERE officer_id=:u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM attendance WHERE user_id = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM visits WHERE user_id = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM tasks WHERE assigned_to = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM day_closures WHERE officer_id = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM crop_issues WHERE user_id = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM leave_requests WHERE officer_id = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM audit_logs WHERE user_id = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM officer_locations WHERE officer_id = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM device_registry WHERE user_id = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM user_territories WHERE user_id = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM weekly_plans WHERE user_id = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM notifications WHERE user_id = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM expenses WHERE user_id = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM enquiries WHERE reported_by = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM daily_work_reports WHERE user_id = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM personal_bests WHERE user_id = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM user_badges WHERE user_id = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM file_uploads WHERE uploaded_by = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM visit_drafts WHERE officer_id = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM officer_product_stock WHERE officer_id = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM officer_stock_adjustments WHERE officer_id = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM officer_monthly_targets WHERE officer_id = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM location_consent_acceptances WHERE user_id = :u").bindparams(u=NA_ID))
        c.execute(text("DELETE FROM attendance WHERE user_id = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM visits WHERE user_id = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM tasks WHERE assigned_to = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM day_closures WHERE officer_id = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM crop_issues WHERE user_id = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM leave_requests WHERE officer_id = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM audit_logs WHERE user_id = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM officer_locations WHERE officer_id = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM device_registry WHERE user_id = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM user_territories WHERE user_id = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM weekly_plans WHERE user_id = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM notifications WHERE user_id = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM expenses WHERE user_id = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM enquiries WHERE reported_by = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM daily_work_reports WHERE user_id = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM personal_bests WHERE user_id = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM user_badges WHERE user_id = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM file_uploads WHERE uploaded_by = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM visit_drafts WHERE officer_id = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM officer_product_stock WHERE officer_id = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM officer_stock_adjustments WHERE officer_id = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM officer_monthly_targets WHERE officer_id = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM location_consent_acceptances WHERE user_id = :uid").bindparams(uid=NA_ID))
        c.execute(text("DELETE FROM users WHERE id = :uid").bindparams(uid=NA_ID))
        c.execute(
            text("""INSERT INTO users (id,email,full_name,role,hashed_password,is_active)
                    VALUES (:i,'na9@test.local','NA Nine','field_officer','x',true)""").bindparams(i=NA_ID)
        )
    yield
    with engine.begin() as c:
        c.execute(text("DELETE FROM day_closures WHERE officer_id=:u").bindparams(u=NA_ID))


async def _post_no_activity_and_dispose(reason):
    from app.infrastructure.database.session import engine as app_engine
    try:
        async with _client(NA_ID, "field_officer") as c:
            r = await c.post("/api/v1/day-closure/no-activity", json={"reason": reason} if reason is not None else {})
            return r.status_code, r.json()
    finally:
        from app.main import app
        app.dependency_overrides.clear()
        await app_engine.dispose()


def test_no_activity_requires_a_reason(na_officer):
    code, body = asyncio.run(_post_no_activity_and_dispose(None))
    assert code == 400
    assert "reason" in body["detail"].lower()


def test_no_activity_with_reason_is_accepted_and_counts_as_submitted(na_officer):
    code, body = asyncio.run(_post_no_activity_and_dispose("On sick leave"))
    assert code == 201
    assert body["closure_type"] == "no_activity"
    # The whole point: it must satisfy the closure requirement.
    data = _warning_status(NA_ID, "field_officer")
    assert data["submitted"] is True
    assert data["warning_due"] is False


def test_no_activity_reason_is_persisted(na_officer, engine):
    asyncio.run(_post_no_activity_and_dispose("Training day, no field visits"))
    with engine.begin() as c:
        row = c.execute(
            text("""SELECT closure_type, no_activity_reason FROM day_closures
                    WHERE officer_id=:u AND date=:d""")
            .bindparams(u=NA_ID, d=datetime.now(IST).date())
        ).first()
    assert row.closure_type == "no_activity"
    assert row.no_activity_reason == "Training day, no field visits"


def test_duplicate_no_activity_is_idempotent(na_officer):
    asyncio.run(_post_no_activity_and_dispose("First"))
    code, body = asyncio.run(_post_no_activity_and_dispose("Second"))
    assert code == 201
    assert body["closure_type"] == "no_activity"


def test_database_rejects_no_activity_without_reason(engine, na_officer):
    """The rule is enforced by the DATABASE too, not just the endpoint -
    so it holds for any future write path (admin back-fill, imports)."""
    import sqlalchemy as sa
    with pytest.raises(sa.exc.IntegrityError):
        with engine.begin() as c:
            c.execute(
                text("""INSERT INTO day_closures (id,officer_id,date,closure_type)
                        VALUES (gen_random_uuid(),:u,:d,'no_activity')""")
                .bindparams(u=NA_ID, d=datetime.now(IST).date())
            )


def test_database_rejects_reason_on_normal_closure(engine, na_officer):
    import sqlalchemy as sa
    with pytest.raises(sa.exc.IntegrityError):
        with engine.begin() as c:
            c.execute(
                text("""INSERT INTO day_closures (id,officer_id,date,closure_type,no_activity_reason)
                        VALUES (gen_random_uuid(),:u,:d,'field_visit','should not be allowed')""")
                .bindparams(u=NA_ID, d=datetime.now(IST).date())
            )
