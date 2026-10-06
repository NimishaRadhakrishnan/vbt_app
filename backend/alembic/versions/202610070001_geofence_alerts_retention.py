"""Territory geofences, persisted location alerts, 90-day GPS retention

* territories gets an optional circular geofence (centre + radius). The old
  `boundary` polygon column stays, but nothing ever filled it in.
* location_alerts stores territory exits and tracking gaps so an admin can
  see them after the fact, not only while a live WebSocket is open.
* The active disclosure now says location history is kept for 90 days, which
  is what the retention job deletes. Shortening the period is in the
  officer's favour, so the existing acceptances stay valid.

Revision ID: 202610070001
Revises: 202610060001
Create Date: 2026-10-07
"""
from typing import Sequence, Union

from alembic import op

revision: str = "202610070001"
down_revision: Union[str, None] = "202610060001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE territories ADD COLUMN IF NOT EXISTS center_lat DOUBLE PRECISION")
    op.execute("ALTER TABLE territories ADD COLUMN IF NOT EXISTS center_lng DOUBLE PRECISION")
    op.execute("ALTER TABLE territories ADD COLUMN IF NOT EXISTS radius_m DOUBLE PRECISION")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS location_alerts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            alert_type VARCHAR(40) NOT NULL,
            message TEXT NOT NULL,
            territory_id UUID REFERENCES territories(id) ON DELETE SET NULL,
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
            ended_at TIMESTAMP WITH TIME ZONE
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_location_alerts_created ON location_alerts (created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_location_alerts_user ON location_alerts (user_id, created_at DESC)"
    )
    op.execute(
        """
        UPDATE location_disclosure_versions
        SET retention_months = 3,
            points = replace(points::text, 'kept for 12 months', 'kept for 90 days')::jsonb
        WHERE is_active
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS location_alerts")
    op.execute("ALTER TABLE territories DROP COLUMN IF EXISTS radius_m")
    op.execute("ALTER TABLE territories DROP COLUMN IF EXISTS center_lng")
    op.execute("ALTER TABLE territories DROP COLUMN IF EXISTS center_lat")
    op.execute(
        """
        UPDATE location_disclosure_versions
        SET retention_months = 12,
            points = replace(points::text, 'kept for 90 days', 'kept for 12 months')::jsonb
        WHERE is_active
        """
    )
