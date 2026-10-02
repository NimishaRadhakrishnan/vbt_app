"""day closures: 'No activity today' closure type with required reason

Revision ID: 202608260018
Revises: 202608260017
Create Date: 2026-09-06 05:00:00

Approved requirement: an officer with genuinely nothing to report (sick,
travelling, no visits) must still be able to close their day. Without
this they would be permanently unable to satisfy the 17:30 warning - and,
once logout enforcement lands, unable to log out at all.

Design:

- Added as a THIRD closure_type ('no_activity') on the existing
  day_closures table, not a separate table and not a boolean flag. The
  CHECK constraint then makes the three states mutually exclusive by
  construction, and every existing query that counts "is there a closure
  row for this officer today" keeps working untouched - including the
  17:30 warning endpoint and the missing-today report.

- The existing UNIQUE(officer_id, date) already enforces the approved
  rule that an officer cannot file both a normal and a no-activity
  closure for the same date. Verified against the live database before
  writing this migration; no additional constraint is needed, and adding
  one would have been redundant.

- `no_activity_reason` is required at the API layer but NULLABLE in the
  schema, because the column must also hold NULL for the thousands of
  existing field_visit / sales_activity rows. A NOT NULL here would fail
  the migration outright. The partial CHECK below enforces the real
  rule: a reason is mandatory if and only if the closure is no_activity.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "202608260018"
down_revision: str | None = "202608260017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("day_closures", sa.Column("no_activity_reason", sa.Text(), nullable=True))

    # Widen closure_type to admit the new state.
    op.drop_constraint("ck_day_closures_type", "day_closures", type_="check")
    op.create_check_constraint(
        "ck_day_closures_type", "day_closures",
        "closure_type IN ('field_visit', 'sales_activity', 'no_activity')",
    )

    # The real integrity rule: a no_activity closure MUST carry a
    # non-empty reason, and the other types must not carry one. Enforced
    # in the database so it holds regardless of which endpoint (officer,
    # admin back-fill, or a future one) writes the row.
    op.create_check_constraint(
        "ck_day_closures_no_activity_reason", "day_closures",
        """
        (closure_type = 'no_activity'
             AND no_activity_reason IS NOT NULL
             AND length(trim(no_activity_reason)) > 0)
        OR
        (closure_type <> 'no_activity' AND no_activity_reason IS NULL)
        """,
    )


def downgrade() -> None:
    op.drop_constraint("ck_day_closures_no_activity_reason", "day_closures", type_="check")
    # Any no_activity rows must be removed before the narrower CHECK can
    # be restored, or the constraint creation fails on existing data.
    op.execute("DELETE FROM day_closures WHERE closure_type = 'no_activity'")
    op.drop_constraint("ck_day_closures_type", "day_closures", type_="check")
    op.create_check_constraint(
        "ck_day_closures_type", "day_closures",
        "closure_type IN ('field_visit', 'sales_activity')",
    )
    op.drop_column("day_closures", "no_activity_reason")
