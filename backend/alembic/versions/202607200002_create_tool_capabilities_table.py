"""create tool_capabilities table

Revision ID: 202607200002
Revises: 202607200001
Create Date: 2026-07-20 00:02:00

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "202607200002"
down_revision: str | None = "202607200001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tool_capabilities",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False
        ),
        sa.Column("server_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "input_schema",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("category", sa.String(length=50), nullable=False),
        sa.Column("risk_score", sa.Integer(), nullable=False),
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
    )
    op.create_index(
        "ix_tool_capabilities_server_id_name",
        "tool_capabilities",
        ["server_id", "name"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_tool_capabilities_server_id_name", table_name="tool_capabilities"
    )
    op.drop_table("tool_capabilities")
