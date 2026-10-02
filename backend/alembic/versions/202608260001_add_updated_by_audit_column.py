"""add updated_by audit column to every TimestampedUUIDMixin table

Revision ID: 202608260001
Revises: 202608250003
Create Date: 2026-08-26 00:00:00

Adds `updated_by` (nullable FK -> users.id, ON DELETE SET NULL) to every
table backed by `TimestampedUUIDMixin`, matching the mixin change in
`base_model.py`. Nullable because existing rows and any future
system/background writes have no attributable user - use cases that
perform an UPDATE set it explicitly going forward; it is never trusted
from client input.

Scope note: this covers the ORM-mapped mixin tables only. The raw-SQL
tables from migration 202608250003 (dealer_payments,
dealer_payment_deadline_history, officer_stock_adjustments,
marketing_materials) are append-only ledgers by design - each row already
records who performed that action (collected_by / requested_by / etc.),
so there is no UPDATE to attribute. `payment_reminder_schedule` (also
202608250003) IS admin-mutable but isn't on the mixin; left out here
deliberately rather than added silently - flagging for a follow-up
migration once that CRUD endpoint is built.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202608260001"
down_revision: str | None = "202608250003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every table currently backed by TimestampedUUIDMixin.
_MIXIN_TABLES = [
    "users",
    "attendance",
    "crop_issues",
    "dealers",
    "products",
    "dealer_stocks",
    "dealer_orders",
    "order_items",
    "stock_movements",
    "expenses",
    "farmers",
    "gps_tracks",
    "notifications",
    "notification_templates",
    "territories",
    "visits",
    "weekly_plans",
    "weekly_plan_activities",
    "weekly_plan_deviations",
]


def upgrade() -> None:
    for table in _MIXIN_TABLES:
        op.add_column(
            table,
            sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        )
        op.create_foreign_key(
            f"fk_{table}_updated_by_users",
            table,
            "users",
            ["updated_by"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    for table in reversed(_MIXIN_TABLES):
        op.drop_constraint(f"fk_{table}_updated_by_users", table, type_="foreignkey")
        op.drop_column(table, "updated_by")
