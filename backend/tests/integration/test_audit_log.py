"""
Audit log writes.

Regression guard for a bug that broke EVERY admin mutation: audit_logs
has `action`, `affected_module` and `updated_at` as NOT NULL, but
write_audit_log() inserted none of them. Because the audit write shares
a transaction with the change it records, the whole admin action rolled
back - surfacing to the user as a generic "Load failed".

These tests assert against the real table, so if a future migration adds
another NOT NULL column the failure shows up here rather than in the UI.
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
USER = uuid.UUID("dcdcdcdc-0000-0000-0000-000000000001")


@pytest.fixture(scope="module")
def engine():
    return create_engine(DB_URL)


@pytest.fixture(autouse=True)
def setup(engine):
    with engine.begin() as c:
        c.execute(text("DELETE FROM audit_logs WHERE user_id=:u").bindparams(u=USER))
        c.execute(text("DELETE FROM attendance WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM visits WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM tasks WHERE assigned_to = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM day_closures WHERE officer_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM crop_issues WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM leave_requests WHERE officer_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM audit_logs WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM officer_locations WHERE officer_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM device_registry WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM user_territories WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM weekly_plans WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM notifications WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM expenses WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM enquiries WHERE reported_by = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM daily_work_reports WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM personal_bests WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM user_badges WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM file_uploads WHERE uploaded_by = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM visit_drafts WHERE officer_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM officer_product_stock WHERE officer_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM officer_stock_adjustments WHERE officer_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM officer_monthly_targets WHERE officer_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM location_consent_acceptances WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM users WHERE id = :uid").bindparams(uid=USER))
        c.execute(text("""INSERT INTO users (id,email,full_name,role,hashed_password,is_active)
                          VALUES (:u,'audit@t.local','Audit T','admin','x',true)""").bindparams(u=USER))
    yield
    with engine.begin() as c:
        c.execute(text("DELETE FROM audit_logs WHERE user_id=:u").bindparams(u=USER))
        c.execute(text("DELETE FROM attendance WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM visits WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM tasks WHERE assigned_to = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM day_closures WHERE officer_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM crop_issues WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM leave_requests WHERE officer_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM audit_logs WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM officer_locations WHERE officer_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM device_registry WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM user_territories WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM weekly_plans WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM notifications WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM expenses WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM enquiries WHERE reported_by = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM daily_work_reports WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM personal_bests WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM user_badges WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM file_uploads WHERE uploaded_by = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM visit_drafts WHERE officer_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM officer_product_stock WHERE officer_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM officer_stock_adjustments WHERE officer_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM officer_monthly_targets WHERE officer_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM location_consent_acceptances WHERE user_id = :uid").bindparams(uid=USER))
        c.execute(text("DELETE FROM users WHERE id = :uid").bindparams(uid=USER))


def _write(event_type, description, context=None):
    from app.infrastructure.audit.audit_log import write_audit_log
    from app.infrastructure.database.session import AsyncSessionLocal
    from app.infrastructure.database.session import engine as app_engine

    async def go():
        try:
            async with AsyncSessionLocal() as s:
                await write_audit_log(
                    s, user_id=USER, event_type=event_type,
                    description=description, context_data=context or {},
                )
                await s.commit()
        finally:
            await app_engine.dispose()
    asyncio.run(go())


def test_audit_write_succeeds(engine):
    """The core regression: this raised NotNullViolationError before."""
    _write("admin_custom_field_create", "Created a field")
    with engine.begin() as c:
        n = c.execute(text("SELECT count(*) FROM audit_logs WHERE user_id=:u").bindparams(u=USER)).scalar()
    assert n == 1


def test_not_null_columns_are_populated(engine):
    _write("admin_custom_field_create", "Created a field")
    with engine.begin() as c:
        row = c.execute(
            text("""SELECT action, affected_module, updated_at, event_type, description
                    FROM audit_logs WHERE user_id=:u""").bindparams(u=USER)
        ).first()
    assert row.action is not None
    assert row.affected_module is not None
    assert row.updated_at is not None


def test_action_and_module_are_derived_meaningfully(engine):
    """Not placeholders - they should describe the change, so the audit
    trail is readable without decoding event_type by eye."""
    _write("admin_custom_field_create", "Created a field")
    with engine.begin() as c:
        row = c.execute(
            text("SELECT action, affected_module FROM audit_logs WHERE user_id=:u").bindparams(u=USER)
        ).first()
    assert row.action == "create"
    assert row.affected_module == "custom_field"


def test_various_event_types_all_write(engine):
    """Every audited admin action, not just the one that surfaced the bug."""
    for et in (
        "admin_knowledge_case_verify",
        "admin_emergency_override_declared",
        "admin_enum_option_add",
        "admin_day_closure_config_edit",
    ):
        _write(et, f"test {et}")
    with engine.begin() as c:
        n = c.execute(text("SELECT count(*) FROM audit_logs WHERE user_id=:u").bindparams(u=USER)).scalar()
    assert n == 4


def test_every_not_null_column_is_covered(engine):
    """Guards the FUTURE: if a migration adds another NOT NULL column
    without a default, this fails here instead of breaking admin actions
    in production."""
    with engine.begin() as c:
        cols = [
            r[0] for r in c.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name='audit_logs' AND is_nullable='NO' AND column_default IS NULL
            """)).fetchall()
        ]
    _write("admin_custom_field_create", "coverage check")
    with engine.begin() as c:
        row = c.execute(
            text("SELECT * FROM audit_logs WHERE user_id=:u LIMIT 1").bindparams(u=USER)
        ).first()
    for col in cols:
        assert getattr(row, col, None) is not None, f"NOT NULL column '{col}' was not populated"
