"""Location history and day closures are kept for 60 days.

Revision ID: 202610140002
Revises: 202610140001
"""
from alembic import op

revision = "202610140002"
down_revision = "202610140001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE location_disclosure_versions
        SET retention_months = 2,
            points = replace(points::text, 'kept for 90 days', 'kept for 60 days')::jsonb
        WHERE is_active
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE location_disclosure_versions
        SET retention_months = 3,
            points = replace(points::text, 'kept for 60 days', 'kept for 90 days')::jsonb
        WHERE is_active
        """
    )
