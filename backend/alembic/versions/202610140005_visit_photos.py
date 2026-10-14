"""Several photos per field visit.

Revision ID: 202610140005
Revises: 202610140004
"""
from alembic import op

revision = "202610140005"
down_revision = "202610140004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS visit_photos (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
            url VARCHAR(500) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_visit_photos_visit ON visit_photos (visit_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS visit_photos")
