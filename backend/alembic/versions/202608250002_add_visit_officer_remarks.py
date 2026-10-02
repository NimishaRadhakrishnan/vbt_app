"""add visits.officer_remarks - Daily Visit Tracker Step 8

Revision ID: 202608250002
Revises: 202608250001
Create Date: 2026-08-25 01:00:00

Small follow-up to the main schema migration: Step 8's "Field Officer
Remarks" free-text field has nowhere honest to live. The submit
endpoint's first draft borrowed voice_notes_transcript_en (an existing
but semantically unrelated column meant for actual voice-note
transcripts) rather than leave the field silently dropped - but reusing
a column for a different purpose than its name says is exactly the kind
of quiet data-mixing this project has already had problems with
elsewhere (see the "Work Done Document" button that actually called
day-closure). A real column is one migration away, so it gets one.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "202608250002"
down_revision: str | None = "202608250001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("visits", sa.Column("officer_remarks", sa.String(2000), nullable=True))


def downgrade() -> None:
    op.drop_column("visits", "officer_remarks")
