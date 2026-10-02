"""add proof to tasks

Revision ID: 7c10461ba2c1
Revises: fd40f6131803
Create Date: 2026-07-31 11:56:23.905175

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '7c10461ba2c1'
down_revision: Union[str, None] = 'fd40f6131803'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("proof_photo_url", sa.String(length=1000), nullable=True))
    op.add_column("tasks", sa.Column("proof_gps_lat", sa.Float(), nullable=True))
    op.add_column("tasks", sa.Column("proof_gps_lng", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "proof_gps_lng")
    op.drop_column("tasks", "proof_gps_lat")
    op.drop_column("tasks", "proof_photo_url")
