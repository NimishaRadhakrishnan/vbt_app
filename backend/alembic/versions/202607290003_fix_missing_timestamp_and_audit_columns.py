"""fix: bring several tables' schema in line with their ORM models

Revision ID: 202607290003
Revises: 202607290002
Create Date: 2026-07-29 00:03:00

Found while validating end-to-end on a fresh database (same class of bug
as 202607290002, affecting `users`): several tables created by the
"vishakan business schema" migration are missing `created_at`/`updated_at`
columns that their ORM models declare via TimestampedUUIDMixin, and
`audit_logs` is still shaped like the original MCP Risk Scanner's audit
log (event_type/description/context_data) rather than the Vishakan
AuditLogModel it's actually mapped to (user_role/device_id/action/
affected_module/old_values/new_values/reason). Every INSERT through the
ORM into any of these tables fails on a fresh database. This migration
adds the missing columns; nothing existing is renamed or dropped, so any
already-populated environment keeps working exactly as before, it just
gains the columns the model has always expected.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "202607290003"
down_revision: str | None = "202607290002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Tables that are only missing `updated_at`
_TABLES_MISSING_UPDATED_AT_ONLY = [
    "attendance",
    "weekly_plan_activities",
    "visits",
    "products",
    "dealer_orders",
    "order_items",
    "notifications",
    "expenses",
]

# Tables missing both created_at and updated_at
_TABLES_MISSING_BOTH = [
    "weekly_plan_deviations",
    "dealer_stocks",
    "stock_movements",
]


def upgrade() -> None:
    for table in _TABLES_MISSING_UPDATED_AT_ONLY:
        op.add_column(
            table,
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )

    for table in _TABLES_MISSING_BOTH:
        op.add_column(
            table,
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.add_column(
            table,
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )

    op.add_column("notification_templates", sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))

    # audit_logs: add the Vishakan-shaped columns the ORM model actually
    # uses. The legacy event_type/description/context_data columns are
    # left in place untouched (harmless, unused by the current model).
    op.add_column("audit_logs", sa.Column("user_role", sa.String(length=50), nullable=True))
    op.add_column("audit_logs", sa.Column("device_id", sa.String(length=100), nullable=True))
    op.add_column("audit_logs", sa.Column("action", sa.String(length=200), nullable=True))
    op.add_column("audit_logs", sa.Column("affected_module", sa.String(length=100), nullable=True))
    op.add_column("audit_logs", sa.Column("old_values", postgresql.JSON(), nullable=True))
    op.add_column("audit_logs", sa.Column("new_values", postgresql.JSON(), nullable=True))
    op.add_column("audit_logs", sa.Column("reason", sa.String(), nullable=True))
    op.add_column("audit_logs", sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    # action/affected_module are NOT NULL on the model; backfill any
    # existing legacy rows before enforcing that, then tighten it.
    op.execute("UPDATE audit_logs SET action = COALESCE(action, event_type, 'unknown') WHERE action IS NULL")
    op.execute("UPDATE audit_logs SET affected_module = COALESCE(affected_module, 'legacy') WHERE affected_module IS NULL")
    op.alter_column("audit_logs", "action", nullable=False)
    op.alter_column("audit_logs", "affected_module", nullable=False)


def downgrade() -> None:
    op.alter_column("audit_logs", "affected_module", nullable=True)
    op.alter_column("audit_logs", "action", nullable=True)
    op.drop_column("audit_logs", "updated_at")
    op.drop_column("audit_logs", "reason")
    op.drop_column("audit_logs", "new_values")
    op.drop_column("audit_logs", "old_values")
    op.drop_column("audit_logs", "affected_module")
    op.drop_column("audit_logs", "action")
    op.drop_column("audit_logs", "device_id")
    op.drop_column("audit_logs", "user_role")

    op.drop_column("notification_templates", "created_at")

    for table in _TABLES_MISSING_BOTH:
        op.drop_column(table, "updated_at")
        op.drop_column(table, "created_at")

    for table in _TABLES_MISSING_UPDATED_AT_ONLY:
        op.drop_column(table, "updated_at")
