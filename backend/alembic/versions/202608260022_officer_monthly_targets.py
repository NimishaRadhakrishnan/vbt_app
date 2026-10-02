"""officer_monthly_targets: admin-set monthly targets driving productivity + momentum

Revision ID: 202608260022
Revises: 202608260021
Create Date: 2026-09-08 07:00:00

Approved: each officer has a monthly target (default 4), set by an
admin, and that target is what Productivity and Momentum & Milestones
measure progress against.

Verified before writing: there was NO targets table and NO target logic
anywhere in the codebase. Productivity computed raw activity counts with
nothing to compare them to, and Momentum awarded badges against
lifetime thresholds seeded in `badges` (50 visits, 100 visits...). So
"70% of target" could not be expressed at all - this table is what makes
that possible.

Metric vocabulary
-----------------
`metric` deliberately reuses the strings already in `badges.metric`
(e.g. 'related_type:farmer') rather than inventing a parallel set. Two
vocabularies for "what are we counting" would drift, and Momentum would
end up measuring something subtly different from Productivity while both
claimed to show the same officer's progress.

Default of 4
------------
Seeded as a flat default for every field/sales officer rather than
derived from history: there is almost no historical activity data in
this system yet, so a "smart" default would be fabricated precision.
Admins override per officer per month via the API - the UNIQUE
constraint below is what makes an override replace rather than
duplicate.

`period` is stored as a DATE pinned to the 1st of the month rather than
a 'YYYY-MM' string, so ordering, range queries and "this month" filters
all use the date index instead of string comparison.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202608260022"
down_revision: str | None = "202608260021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFAULT_MONTHLY_TARGET = 4

# The metric a plain monthly target counts. Matches the badge vocabulary
# for farmer visits, which is the activity both Productivity and
# Momentum already track per officer.
DEFAULT_METRIC = "related_type:farmer"


def upgrade() -> None:
    op.create_table(
        "officer_monthly_targets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("officer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        # First day of the month this target applies to.
        sa.Column("period", sa.Date(), nullable=False),
        sa.Column("metric", sa.String(50), nullable=False, server_default=DEFAULT_METRIC),
        sa.Column("target_value", sa.Integer(), nullable=False, server_default=str(DEFAULT_MONTHLY_TARGET)),
        # Why the admin chose this number - the audit trail for a target
        # that differs from the default (bigger territory, new joiner).
        sa.Column("notes", sa.String(300), nullable=True),
        sa.Column("set_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        # One target per officer per month per metric - this is what makes
        # an admin edit an UPDATE rather than a second, conflicting row.
        sa.UniqueConstraint("officer_id", "period", "metric", name="uq_officer_target_period_metric"),
        sa.CheckConstraint("target_value >= 0", name="ck_officer_target_non_negative"),
    )
    op.create_index("ix_officer_targets_period", "officer_monthly_targets", ["period"])
    op.create_index("ix_officer_targets_officer", "officer_monthly_targets", ["officer_id"])

    # Seed the current month for existing field/sales officers so the
    # feature has meaning immediately rather than showing "no target set"
    # until an admin visits the page.
    op.execute(
        f"""
        INSERT INTO officer_monthly_targets (id, officer_id, period, metric, target_value)
        SELECT gen_random_uuid(), u.id, date_trunc('month', CURRENT_DATE)::date,
               '{DEFAULT_METRIC}', {DEFAULT_MONTHLY_TARGET}
        FROM users u
        WHERE u.role IN ('field_officer', 'sales_officer') AND u.is_active = true
        ON CONFLICT ON CONSTRAINT uq_officer_target_period_metric DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_index("ix_officer_targets_officer", table_name="officer_monthly_targets")
    op.drop_index("ix_officer_targets_period", table_name="officer_monthly_targets")
    op.drop_table("officer_monthly_targets")
