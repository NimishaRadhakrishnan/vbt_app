"""KPI module phase 6: nudge log (max one a day) and phone push tokens.

Revision ID: 202611040001
Revises: 202611030001
"""
import re

from alembic import op

revision = "202611040001"
down_revision = "202611030001"
branch_labels = None
depends_on = None


def _types() -> list[str]:
    """The notification types the database allows today, read from the live constraint."""
    d = op.get_bind().exec_driver_sql(
        "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'notifications_type_check'").scalar()
    return re.findall(r"'([^']+)'", d or "")


def _set_types(types: list[str]) -> None:
    op.execute("ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check")
    quoted = ", ".join("'" + t + "'" for t in types)
    op.execute(f"ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN ({quoted}))")


def upgrade() -> None:
    types = _types()
    if "kpi_nudge" not in types:
        _set_types(types + ["kpi_nudge"])
    op.execute("""
        CREATE TABLE kpi_nudge_log (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            officer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind varchar(20) NOT NULL,
            nudge_key varchar(120) NOT NULL,
            delivered boolean NOT NULL DEFAULT true,
            sent_on date NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (officer_id, nudge_key)
        )
    """)
    op.execute("CREATE INDEX ix_kpi_nudge_log_day ON kpi_nudge_log (officer_id, sent_on) WHERE delivered")
    op.execute("""
        CREATE TABLE push_token (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token varchar(200) NOT NULL UNIQUE,
            platform varchar(20),
            created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX ix_push_token_user ON push_token (user_id)")


def downgrade() -> None:
    op.execute("DELETE FROM notifications WHERE type = 'kpi_nudge'")
    _set_types([x for x in _types() if x != "kpi_nudge"])
    op.execute("DROP TABLE IF EXISTS push_token")
    op.execute("DROP TABLE IF EXISTS kpi_nudge_log")
