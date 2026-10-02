"""add accuracy column to officer_locations

Revision ID: 202607300001
Revises: 202607290005
Create Date: 2026-07-30
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "202607300001"
down_revision = "202607290005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "officer_locations",
        sa.Column("accuracy", sa.Double(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("officer_locations", "accuracy")
