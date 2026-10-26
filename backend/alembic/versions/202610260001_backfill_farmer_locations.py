"""give farmers registered through a visit the location of that first visit

Farmers created by the visit form / day closure were saved without a
location, so they never appeared on the live map. Fill them in from their
earliest visit that has a real position.

Revision ID: 202610260001
Revises: 202610230001
"""
from alembic import op

revision = "202610260001"
down_revision = "202610230001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        UPDATE farmers f SET location = v.location_start
        FROM (
            SELECT DISTINCT ON (farmer_id) farmer_id, location_start
            FROM visits
            WHERE farmer_id IS NOT NULL AND location_start IS NOT NULL
              AND NOT (ST_X(location_start::geometry) = 0 AND ST_Y(location_start::geometry) = 0)
            ORDER BY farmer_id, start_time
        ) v
        WHERE f.id = v.farmer_id AND f.location IS NULL AND f.is_deleted = false
    """)


def downgrade() -> None:
    pass  # data fill only; nothing to undo
