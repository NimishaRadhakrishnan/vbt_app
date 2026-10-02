"""add file_uploads table for upload ownership tracking

Revision ID: 202608130001
Revises: 202608090001
Create Date: 2026-08-13 00:01:00

Previously, none of the four upload endpoints (crop_issue, daily_report,
day_closure, enquiry - all byte-for-byte identical implementations) recorded
who uploaded a file at all; they just wrote it to disk and returned a URL.
That made it structurally impossible to answer "should this specific user
be allowed to view this specific file" - there was no ownership data
anywhere to check against. This table is the minimum needed to make that
question answerable: which file, uploaded by whom, when.

filename is the primary key (not a separate id) because the stored
filename is already a UUID generated at upload time - a second surrogate
key would be redundant.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202608130001"
down_revision: str | None = "202608090001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "file_uploads",
        sa.Column("filename", sa.String(length=255), primary_key=True),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_file_uploads_uploaded_by", "file_uploads", ["uploaded_by"])


def downgrade() -> None:
    op.drop_index("ix_file_uploads_uploaded_by", table_name="file_uploads")
    op.drop_table("file_uploads")
