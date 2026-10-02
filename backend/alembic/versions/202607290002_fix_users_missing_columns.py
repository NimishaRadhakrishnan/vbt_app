"""fix: add missing employee_id/device_id/biometric_token/manager_id/last_login_at to users

Revision ID: 202607290002
Revises: 202607290001
Create Date: 2026-07-29 00:02:00

Pre-existing bug found while validating the leave/HR/enquiry/day-closure
migration end to end on a fresh database: UserModel (the ORM model
actually used by the app) declares employee_id, device_id,
biometric_token, manager_id, and last_login_at, but the original
create_users_table migration never created any of these columns. On a
fresh DB this makes every INSERT INTO users fail immediately with
"column does not exist" — it was never exercised end-to-end before,
since existing dev databases likely had these columns added by hand or
via a different path. This migration brings the schema in line with the
model; all columns are nullable/optional so it's purely additive.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "202607290002"
down_revision: str | None = "202607290001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("employee_id", sa.String(length=50), nullable=True))
    op.create_index("ix_users_employee_id", "users", ["employee_id"], unique=True)
    op.add_column("users", sa.Column("device_id", sa.String(length=100), nullable=True))
    op.add_column("users", sa.Column("biometric_token", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("manager_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_users_manager_id_users",
        "users",
        "users",
        ["manager_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "last_login_at")
    op.drop_constraint("fk_users_manager_id_users", "users", type_="foreignkey")
    op.drop_column("users", "manager_id")
    op.drop_column("users", "biometric_token")
    op.drop_column("users", "device_id")
    op.drop_index("ix_users_employee_id", table_name="users")
    op.drop_column("users", "employee_id")
