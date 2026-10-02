"""day_closures: link to a full visit record instead of duplicating its data

Revision ID: 202608260005
Revises: 202608260004
Create Date: 2026-08-26 03:00:00

Per direct request, Day Closure's daily submission now needs to capture
the full farm-visit detail (crop profile, pest/disease diagnosis, NPK,
demo/trial, sales conversion, photos, etc.) - the same ~40-field form
already fully modelled by the Daily Visit Tracker feature (15 satellite
tables under `visits`, see 202608250001 and
daily_visit_tracker_schemas.py). Recreating that entire schema a second
time under day_closures would leave two parallel, inevitably-drifting
copies of the same data model for the same underlying concept.

Instead: day_closures becomes a thin daily marker that POINTS AT a real
visits row (created through the exact same submit_daily_visit() function
Daily Visit Tracker already uses) rather than storing the detail itself.
The 202608260004 columns (farmers_visited/villages_covered/
demos_conducted/conversions/blockers) are left in place, untouched and
still nullable, rather than dropped - they were a real, if short-lived,
previous version of this same feature, and dropping columns a batch
before superseding them is unnecessary churn.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202608260005"
down_revision: str | None = "202608260004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("day_closures", sa.Column("visit_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_day_closures_visit_id_visits", "day_closures", "visits", ["visit_id"], ["id"], ondelete="SET NULL"
    )


def downgrade() -> None:
    op.drop_constraint("fk_day_closures_visit_id_visits", "day_closures", type_="foreignkey")
    op.drop_column("day_closures", "visit_id")
