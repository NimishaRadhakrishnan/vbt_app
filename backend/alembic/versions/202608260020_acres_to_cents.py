"""land area: acres -> cents (1 acre = 100 cents)

Revision ID: 202608260020
Revises: 202608260019
Create Date: 2026-09-07 12:00:00

Approved requirement: land area is captured and displayed in CENTS
throughout the application. 1 acre = 100 cents.

Why the columns are RENAMED, not just relabelled in the UI
----------------------------------------------------------
Leaving a column called `acres` while storing cents is how unit bugs
get written years later - someone reads `farmer.acres` and reasonably
assumes acres. Renaming makes the stored unit unambiguous at every
call site, and the compiler/ORM surfaces anything left unconverted
instead of it failing silently at runtime.

Existing data
-------------
Verified against the live database before writing this: farmers.acres,
visits.farm_size_value, visits.acres_covered and
visit_trial_details.trial_plot_size_acres all contain ZERO non-null
rows. So the multiply-by-100 below is a no-op on real data today, and
carries no corruption risk.

The UPDATE is still written out rather than skipped, because this
migration must remain correct if it is ever applied to an environment
that DOES hold acre-denominated rows (a staging copy, a restored
backup). Skipping it there would silently reinterpret 2 acres as 2
cents - a 100x understatement.

Not touched
-----------
farm_size_unit stays as-is: it is a free-text unit label used by the
Daily Visit Tracker, and callers now write 'cents' into it. Weight,
hectare and square-foot fields elsewhere are deliberately untouched -
the requirement is land area only.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "202608260020"
down_revision: str | None = "202608260019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ACRE_TO_CENT = 100


def upgrade() -> None:
    # --- Convert stored values first, while the columns still carry
    # their acre-denominated names. Order matters: converting after the
    # rename would read as "cents * 100", which is wrong. ---
    op.execute(f"UPDATE farmers SET acres = acres * {ACRE_TO_CENT} WHERE acres IS NOT NULL")
    op.execute(
        f"UPDATE visits SET farm_size_value = farm_size_value * {ACRE_TO_CENT} "
        f"WHERE farm_size_value IS NOT NULL AND lower(coalesce(farm_size_unit,'acres')) IN ('acre','acres')"
    )
    op.execute(f"UPDATE visits SET acres_covered = acres_covered * {ACRE_TO_CENT} WHERE acres_covered IS NOT NULL")
    op.execute(
        f"UPDATE visit_trial_details SET trial_plot_size_acres = trial_plot_size_acres * {ACRE_TO_CENT} "
        f"WHERE trial_plot_size_acres IS NOT NULL"
    )
    # Any row already recorded in acres now holds cents, so the unit
    # label must follow or the two disagree.
    op.execute(
        "UPDATE visits SET farm_size_unit = 'cents' "
        "WHERE lower(coalesce(farm_size_unit,'acres')) IN ('acre','acres')"
    )

    # --- Rename so the unit is unambiguous at every call site ---
    op.alter_column("farmers", "acres", new_column_name="cents")
    op.alter_column("visits", "acres_covered", new_column_name="cents_covered")
    op.alter_column("visit_trial_details", "trial_plot_size_acres", new_column_name="trial_plot_size_cents")


def downgrade() -> None:
    op.alter_column("visit_trial_details", "trial_plot_size_cents", new_column_name="trial_plot_size_acres")
    op.alter_column("visits", "cents_covered", new_column_name="acres_covered")
    op.alter_column("farmers", "cents", new_column_name="acres")

    op.execute(
        "UPDATE visits SET farm_size_unit = 'acres' WHERE lower(coalesce(farm_size_unit,'')) = 'cents'"
    )
    op.execute(
        f"UPDATE visit_trial_details SET trial_plot_size_acres = trial_plot_size_acres / {ACRE_TO_CENT} "
        f"WHERE trial_plot_size_acres IS NOT NULL"
    )
    op.execute(f"UPDATE visits SET acres_covered = acres_covered / {ACRE_TO_CENT} WHERE acres_covered IS NOT NULL")
    op.execute(
        f"UPDATE visits SET farm_size_value = farm_size_value / {ACRE_TO_CENT} WHERE farm_size_value IS NOT NULL"
    )
    op.execute(f"UPDATE farmers SET acres = acres / {ACRE_TO_CENT} WHERE acres IS NOT NULL")
