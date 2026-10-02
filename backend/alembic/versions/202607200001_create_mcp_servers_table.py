"""create mcp_servers table

Revision ID: 202607200001
Revises: 202607190001
Create Date: 2026-07-20 00:01:00

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "202607200001"
down_revision: str | None = "202607190001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mcp_servers",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False
        ),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("endpoint", sa.String(length=2048), nullable=False),
        sa.Column(
            "discovery_status",
            sa.String(length=20),
            nullable=False,
            server_default="discovered",
        ),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("discovered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
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
    )
    op.create_index(
        "ix_mcp_servers_endpoint", "mcp_servers", ["endpoint"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_mcp_servers_endpoint", table_name="mcp_servers")
    op.drop_table("mcp_servers")
