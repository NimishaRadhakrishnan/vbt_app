"""consolidate gps_tracks single-column indexes into one composite

Revision ID: 202608070001
Revises: 7c10461ba2c1
Create Date: 2026-08-07 00:01:00

Replaces the two single-column indexes from 202607240001
(ix_gps_tracks_user_id, ix_gps_tracks_recorded_at) with one composite
(user_id, recorded_at) index, rather than adding the composite as a third
index alongside them.

Why drop, not just add: the only read query against this table -
GET /location/history/{officer_id} in location_router.py - filters on
`user_id = :officer_id AND DATE(recorded_at ...) = :target_date` together,
every time. There is no query anywhere in this codebase that filters on
either column alone. A composite (user_id, recorded_at) index still
serves a hypothetical future user_id-only query via Postgres's
leftmost-prefix rule, so nothing is lost by dropping ix_gps_tracks_user_id
specifically. ix_gps_tracks_recorded_at has no such equivalent and would
become pure dead weight: a third index maintained on every /location/ping
write (continuous, all day, for every checked-in officer) serving no
query that benefits from it.

NOTE on the spatial index: an earlier draft of this migration also added
a GiST index on the `location` Geography column, believing it was
missing (per the original FFM audit). Running this migration against a
real Postgres+PostGIS instance surfaced that this was wrong -
`idx_gps_tracks_location` already exists, auto-created by GeoAlchemy2 as
a side effect of `Geography(...)`'s spatial_index=True default the
moment 202607240001's op.create_table() ran, with no explicit
CREATE INDEX line anywhere in that migration's source. Adding a second
GiST index on the same single column would have been a pure duplicate -
maintained on every write, serving no query the first one doesn't already
serve. Caught by actually running this migration rather than trusting
the audit's claim or the migration's own syntax on inspection alone.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "202608070001"
down_revision: str | None = "7c10461ba2c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("ix_gps_tracks_recorded_at", table_name="gps_tracks")
    op.drop_index("ix_gps_tracks_user_id", table_name="gps_tracks")

    op.create_index(
        "ix_gps_tracks_user_id_recorded_at",
        "gps_tracks",
        ["user_id", "recorded_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_gps_tracks_user_id_recorded_at", table_name="gps_tracks")

    op.create_index("ix_gps_tracks_user_id", "gps_tracks", ["user_id"])
    op.create_index("ix_gps_tracks_recorded_at", "gps_tracks", ["recorded_at"])

