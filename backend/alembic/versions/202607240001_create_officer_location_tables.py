"""create officer_locations and gps_tracks tables

Revision ID: 202607240001
Revises: 202607230002
Create Date: 2026-07-24 00:01:00

officer_locations holds the single latest known position per officer
(upserted on every POST /location/ping call) and is what
GET /location/active reads from for the live tracking map. Its absence
was the root cause of every ping and every active-location fetch failing
silently against a missing table.

gps_tracks holds the full ping history per officer for future trail/replay
features, matching GPSTrackModel exactly. It depends on PostGIS — the
postgis/postgis Docker image ships the extension binaries, but a database
still has to switch it on explicitly, which this migration does first.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from geoalchemy2 import Geography
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "202607240001"
down_revision: str | None = "202607230002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    op.create_table(
        "officer_locations",
        sa.Column("officer_id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("latitude", sa.Double(), nullable=True),
        sa.Column("longitude", sa.Double(), nullable=True),
        sa.Column("speed", sa.Double(), nullable=True),
        sa.Column("battery_level", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="active"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["officer_id"], ["users.id"], ondelete="CASCADE"),
    )

    op.create_table(
        "gps_tracks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("location", Geography(geometry_type="POINT", srid=4326), nullable=False),
        sa.Column("accuracy", sa.Double(), nullable=False),
        sa.Column("speed", sa.Double(), nullable=False, server_default="0.0"),
        sa.Column("is_idle", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("distance_from_prev", sa.Double(), nullable=False, server_default="0.0"),
        sa.Column("territory_violation", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("battery_level", sa.Integer(), nullable=True),
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
            onupdate=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_gps_tracks_user_id", "gps_tracks", ["user_id"])
    op.create_index("ix_gps_tracks_recorded_at", "gps_tracks", ["recorded_at"])


def downgrade() -> None:
    op.drop_index("ix_gps_tracks_recorded_at", table_name="gps_tracks")
    op.drop_index("ix_gps_tracks_user_id", table_name="gps_tracks")
    op.drop_table("gps_tracks")
    op.drop_table("officer_locations")
