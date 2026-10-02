"""add status and requested_by to dealers (for Sales Officer add + Admin approval)

Revision ID: 202607280001
Revises: 202607270001
Create Date: 2026-07-28 00:01:00

Additive only: existing dealers default to 'active' so nothing already
approved changes behavior. New column lets a Sales-Officer-created dealer
sit as 'pending_approval' until an Admin/Manager approves or rejects it.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "202607280001"
down_revision: str | None = "202607270001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "dealers",
        sa.Column("status", sa.String(length=30), nullable=False, server_default="active"),
    )
    op.add_column(
        "dealers",
        sa.Column("requested_by", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_dealers_requested_by_users",
        "dealers",
        "users",
        ["requested_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_check_constraint(
        "ck_dealers_status",
        "dealers",
        "status IN ('pending_approval', 'active', 'rejected')",
    )
    op.create_index("ix_dealers_status", "dealers", ["status"])


def downgrade() -> None:
    op.drop_index("ix_dealers_status", table_name="dealers")
    op.drop_constraint("ck_dealers_status", "dealers", type_="check")
    op.drop_constraint("fk_dealers_requested_by_users", "dealers", type_="foreignkey")
    op.drop_column("dealers", "requested_by")
    op.drop_column("dealers", "status")
