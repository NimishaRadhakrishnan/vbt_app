"""day_closures: structured daily questions instead of required photo

Revision ID: 202608260004
Revises: 202608260003
Create Date: 2026-08-26 02:00:00

Day Closure previously required a photo/document upload as the only real
content ("Upload a photo or document confirming your tasks are complete
for today" - see the mobile DayClosureGateModal.tsx and the web work-doc
tab it mirrors). Per direct request, this replaces that with a short set
of self-reported daily numbers, matching the KPI categories already
tracked elsewhere in this system (farmers/villages/demos/conversions -
see Daily Visit Tracker and the FO Dashboard concept), rolled up to a
once-a-day self-report rather than re-deriving it from Daily Visit
Tracker submissions - this stays a manual quick pulse-check, not a
computed aggregate, matching what was actually asked for.

document_url/notes are kept (existing rows, and an officer may still
want to attach something), just no longer required - hence dropping the
NOT NULL constraint rather than dropping the column, so nothing existing
breaks.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "202608260004"
down_revision: str | None = "202608260003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NEW_COLUMNS = [
    ("farmers_visited", sa.Integer()),
    ("villages_covered", sa.Integer()),
    ("demos_conducted", sa.Integer()),
    ("conversions", sa.Integer()),
    ("blockers", sa.Text()),
]


def upgrade() -> None:
    op.alter_column("day_closures", "document_url", existing_type=sa.String(), nullable=True)
    for name, col_type in _NEW_COLUMNS:
        op.add_column("day_closures", sa.Column(name, col_type, nullable=True))


def downgrade() -> None:
    for name, _ in _NEW_COLUMNS:
        op.drop_column("day_closures", name)
    op.alter_column("day_closures", "document_url", existing_type=sa.String(), nullable=False)
