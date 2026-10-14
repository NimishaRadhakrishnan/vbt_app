"""Weekly plans carry an explicit start/end date and a short work description.

Revision ID: 202610140009
Revises: 202610140008
"""
from alembic import op

revision = "202610140009"
down_revision = "202610140008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE weekly_plans ADD COLUMN IF NOT EXISTS end_date date")
    op.execute("ALTER TABLE weekly_plans ADD COLUMN IF NOT EXISTS summary text")
    op.execute("UPDATE weekly_plans SET end_date = week_start_date + 6 WHERE end_date IS NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE weekly_plans DROP COLUMN IF EXISTS summary")
    op.execute("ALTER TABLE weekly_plans DROP COLUMN IF EXISTS end_date")
