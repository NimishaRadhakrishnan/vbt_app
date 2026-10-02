"""create governance_recommendations table

Revision ID: 202607220001
Revises: 202607210002
Create Date: 2026-07-22 00:01:00

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "202607220001"
down_revision: str | None = "202607210002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "governance_recommendations",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False
        ),
        sa.Column("server_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("finding_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("recommendation_text", sa.Text(), nullable=False),
        sa.Column("suggested_action", sa.String(length=255), nullable=False),
        sa.Column(
            "status", sa.String(length=20), nullable=False, server_default="pending"
        ),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "acknowledged_by", postgresql.UUID(as_uuid=True), nullable=True
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["server_id"], ["mcp_servers.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["finding_id"], ["risk_findings.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["acknowledged_by"], ["users.id"], ondelete="RESTRICT"
        ),
    )


def downgrade() -> None:
    op.drop_table("governance_recommendations")
