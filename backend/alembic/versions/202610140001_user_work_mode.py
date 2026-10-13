"""Per-officer work mode: field, sales or both

Decides which day closure and which dashboard an officer sees. Set by an
admin on the Team page. Everyone starts as 'both', so no officer loses a
screen when this is deployed; the admin then narrows it per officer.

Revision ID: 202610140001
Revises: 202610130002
Create Date: 2026-10-14
"""
from typing import Sequence, Union

from alembic import op

revision: str = "202610140001"
down_revision: Union[str, None] = "202610130002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS work_mode VARCHAR(10) NOT NULL DEFAULT 'both'")
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_work_mode")
    op.execute(
        "ALTER TABLE users ADD CONSTRAINT ck_users_work_mode "
        "CHECK (work_mode IN ('field', 'sales', 'both'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_work_mode")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS work_mode")
