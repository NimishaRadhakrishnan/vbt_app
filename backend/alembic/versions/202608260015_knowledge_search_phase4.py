"""knowledge search phase 4: solution feedback

Revision ID: 202608260015
Revises: 202608260014
Create Date: 2026-09-03 20:00:00

Phase 4: closing the quality loop (spec sections 21, 22, 23).

`solution_feedback` records whether a case/solution actually helped the
officer who opened it, with a structured reason when it did not. This is
what turns "47 officers viewed this" into "41 found it useful, 6 did
not" - the difference between a popularity number and a quality signal.

One row per (officer, case) pair, enforced by a unique constraint:
without it a single officer clicking twice would skew the counts, and
the section 22 statistics stop being trustworthy. Re-submitting updates
the existing row instead of adding a second.

`case_id` rather than `solution_id` is the anchor because feedback is
given in the context of a specific case the officer read - a solution
can be attached to many cases, and "this didn't help" usually means
"this case wasn't the right match for my situation", which is
information about the pairing, not necessarily about the solution text.
The solution is still recorded (nullable) so section 22's per-solution
rollup works.

The denormalized counters on `solutions` (helpful_count /
not_helpful_count, added in Phase 2) are updated alongside inserts here.
That is a deliberate trade: recomputing from this table on every read
would be correct but slow on the admin dashboard, and these counters are
only ever display statistics - never used to gate what an officer is
shown, so a rare drift cannot cause a wrong solution to surface.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202608260015"
down_revision: str | None = "202608260014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_REASONS = "('not_relevant','incorrect','outdated','incomplete','other')"


def upgrade() -> None:
    op.create_table(
        "solution_feedback",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("knowledge_cases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("solution_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("solutions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("officer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("was_useful", sa.Boolean(), nullable=False),
        # Only meaningful when was_useful = false (spec section 21).
        sa.Column("reason", sa.String(20), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(f"reason IS NULL OR reason IN {_REASONS}", name="ck_solution_feedback_reason"),
        # A "not useful" answer without a reason is far less actionable,
        # but forcing one would push officers to pick something arbitrary
        # just to dismiss the prompt - so the reason stays optional and
        # the UI asks for it rather than demanding it.
        sa.UniqueConstraint("case_id", "officer_id", name="uq_solution_feedback_case_officer"),
    )
    op.create_index("ix_solution_feedback_case", "solution_feedback", ["case_id"])
    op.create_index("ix_solution_feedback_solution", "solution_feedback", ["solution_id"])


def downgrade() -> None:
    op.drop_index("ix_solution_feedback_solution", table_name="solution_feedback")
    op.drop_index("ix_solution_feedback_case", table_name="solution_feedback")
    op.drop_table("solution_feedback")
