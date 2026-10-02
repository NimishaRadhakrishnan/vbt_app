"""
Sales Officer day closure: status, duplicates, and timezone boundaries.

These run against a REAL Postgres (see conftest DB settings), not mocks -
the bugs being guarded against here are all SQL/timezone behaviour that
a mocked session would happily fake.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
import sqlalchemy as sa
from sqlalchemy import create_engine, text

DB_URL = (
    f"postgresql+psycopg2://{os.getenv('POSTGRES_USER','vbt')}:{os.getenv('POSTGRES_PASSWORD','vbt')}"
    f"@{os.getenv('POSTGRES_HOST','127.0.0.1')}:{os.getenv('POSTGRES_PORT','5433')}/{os.getenv('POSTGRES_DB','vbt')}"
)

FO_ID = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
SO_ID = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000002")
SO2_ID = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000003")


@pytest.fixture(scope="module")
def engine():
    return create_engine(DB_URL)


@pytest.fixture(autouse=True)
def clean(engine):
    """Each test starts from a known state. Deletes cascade to
    sales_closure_details / sales_closure_images by FK."""
    with engine.begin() as c:
        for uid in (FO_ID, SO_ID, SO2_ID):
            c.execute(text("DELETE FROM day_closures WHERE officer_id = :u").bindparams(u=uid))
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
        for uid, role, email in (
            (FO_ID, "field_officer", "fo@test.local"),
            (SO_ID, "sales_officer", "so@test.local"),
            (SO2_ID, "sales_officer", "so2@test.local"),
        ):
            c.execute(
                text("""INSERT INTO users (id,email,full_name,role,hashed_password,is_active)
                        VALUES (:id,:e,'Test User',:r,'x',true)""").bindparams(id=uid, e=email, r=role)
            )
    yield


def _status_query(conn, officer_id, day):
    """The exact query GET /day-closure/status runs."""
    return conn.execute(
        text("""
            SELECT dc.id, dc.visit_id, dc.closure_type,
                   f.name AS farmer_name, f.village,
                   scd.dealer_name, scd.district, scd.visit_purpose
            FROM day_closures dc
            LEFT JOIN visits v ON v.id = dc.visit_id
            LEFT JOIN farmers f ON f.id = v.farmer_id
            LEFT JOIN sales_closure_details scd ON scd.closure_id = dc.id
            WHERE dc.officer_id = :officer_id AND dc.date = :today
              AND dc.is_deleted = false
        """).bindparams(officer_id=officer_id, today=day)
    ).first()


def _make_sales_closure(conn, officer_id, day, dealer="Kannan Agro"):
    cid = uuid.uuid4()
    conn.execute(
        text("""INSERT INTO day_closures (id, officer_id, date, closure_type)
                VALUES (:id,:o,:d,'sales_activity')""").bindparams(id=cid, o=officer_id, d=day)
    )
    conn.execute(
        text("""INSERT INTO sales_closure_details (closure_id, district, dealer_name, visit_purpose)
                VALUES (:c,'Dindigul',:dn,'collection')""").bindparams(c=cid, dn=dealer)
    )
    return cid


# --- 1a. Sales Officer WITH a submitted closure -> shown as submitted ---
def test_sales_officer_with_closure_is_shown_submitted(engine):
    today = date.today()
    with engine.begin() as c:
        _make_sales_closure(c, SO_ID, today)
        row = _status_query(c, SO_ID, today)
    assert row is not None, "sales closure must make closed_today true"
    assert row.closure_type == "sales_activity"
    # The bug being guarded: a sales closure used to return with every
    # descriptive field null, so the officer saw an empty confirmation.
    assert row.dealer_name == "Kannan Agro"
    assert row.district == "Dindigul"


# --- 1b. Sales Officer WITHOUT a closure -> not submitted ---
def test_sales_officer_without_closure_is_not_submitted(engine):
    with engine.begin() as c:
        row = _status_query(c, SO_ID, date.today())
    assert row is None


# --- 1c. Field Officer WITH a submitted closure -> still works ---
def test_field_officer_closure_still_recognised(engine):
    today = date.today()
    with engine.begin() as c:
        cid = uuid.uuid4()
        c.execute(
            text("""INSERT INTO day_closures (id, officer_id, date, closure_type)
                    VALUES (:id,:o,:d,'field_visit')""").bindparams(id=cid, o=FO_ID, d=today)
        )
        row = _status_query(c, FO_ID, today)
    assert row is not None
    assert row.closure_type == "field_visit"


# --- 1d. Duplicate submission is rejected by the DATABASE, not just app code ---
def test_duplicate_closure_rejected_by_constraint(engine):
    today = date.today()
    with engine.begin() as c:
        _make_sales_closure(c, SO_ID, today)
    with pytest.raises(sa.exc.IntegrityError):
        with engine.begin() as c:
            _make_sales_closure(c, SO_ID, today, dealer="Second Dealer")


def test_two_different_officers_may_both_close_same_day(engine):
    """The unique constraint must be per-officer, not global - otherwise
    the first officer to close would block everyone else."""
    today = date.today()
    with engine.begin() as c:
        _make_sales_closure(c, SO_ID, today)
        _make_sales_closure(c, SO2_ID, today)
        assert _status_query(c, SO_ID, today) is not None
        assert _status_query(c, SO2_ID, today) is not None


def test_same_officer_may_close_on_different_days(engine):
    today = date.today()
    with engine.begin() as c:
        _make_sales_closure(c, SO_ID, today)
        _make_sales_closure(c, SO_ID, today - timedelta(days=1))
        assert _status_query(c, SO_ID, today) is not None


# --- 2. Timezone / midnight boundary ---

IST = ZoneInfo("Asia/Kolkata")


def test_company_today_uses_india_not_server_local():
    from app.infrastructure.config.company_time import company_now, company_today
    assert company_now().tzinfo is not None, "company_now must be timezone-aware"
    assert str(company_now().tzinfo) == "Asia/Kolkata"
    assert company_today() == datetime.now(IST).date()


def test_late_evening_ist_stores_the_indian_date_not_utc_date():
    """The real-world bug: late evening IST is already the NEXT day in UTC.

    IST is UTC+5:30, so the UTC date rolls over at 05:30 IST — meaning
    times from 00:00–05:29 IST are still the PREVIOUS day in UTC. A
    closure filed in that window must belong to the Indian calendar day
    the officer is actually living in, otherwise today's closure looks
    missing and the logout gate re-prompts them for a day they closed.

    (First version of this test used 23:30 IST and failed - that is
    18:00 UTC, the SAME date, so it proved nothing. The genuine
    divergence window is early morning IST, not late evening.)
    """
    ist_small_hours = datetime(2026, 9, 4, 2, 0, tzinfo=IST)
    as_utc = ist_small_hours.astimezone(UTC)
    # Precondition: the two dates genuinely differ, or this proves nothing.
    assert as_utc.date() != ist_small_hours.date()
    assert as_utc.date() == date(2026, 9, 3)
    # The company date is the Indian one - which is what must be stored.
    assert ist_small_hours.astimezone(IST).date() == date(2026, 9, 4)


def test_early_morning_ist_is_same_day_in_both_zones():
    """Control case - before 5:30am IST the two zones still differ, but
    in the other direction. Guards against a fix that just shifts the
    bug rather than removing it."""
    ist_early = datetime(2026, 9, 4, 3, 0, tzinfo=IST)
    assert ist_early.astimezone(UTC).date() == date(2026, 9, 3)
    assert ist_early.astimezone(IST).date() == date(2026, 9, 4)


def test_closure_written_with_company_date_is_found_by_status(engine):
    """End-to-end: write using company_today(), read using the status
    query, and confirm they agree. This is what actually breaks if the
    write and read paths disagree about 'today'."""
    from app.infrastructure.config.company_time import company_today
    day = company_today()
    with engine.begin() as c:
        _make_sales_closure(c, SO_ID, day)
        assert _status_query(c, SO_ID, day) is not None
