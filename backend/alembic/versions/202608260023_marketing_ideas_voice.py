"""marketing: officer ideas, voice notes, and admin moderation

Revision ID: 202608260023
Revises: 202608260022
Create Date: 2026-09-08 07:30:00

Approved: officers can send an idea to the admin - text, and/or a
picture, and/or a voice note - and the admin can then save or delete it.

Verified before writing, and the reason this needs a migration at all:

  marketing_materials.image_url is NOT NULL and there is no audio
  column.

So today an officer physically cannot submit an idea without attaching a
picture, and cannot attach a voice note under any circumstances. The
feature was impossible, not merely missing a screen.

Changes
-------
1. image_url -> NULLABLE. An idea may be text-only or voice-only.
   Widening a NOT NULL is safe: every existing row already has a value,
   so nothing is invalidated.

2. audio_url added. Reuses the same upload pipeline as images
   (save_upload stores any file and returns a URL) rather than
   introducing separate audio storage.

3. submission_type: 'material' | 'idea'. Existing rows are backfilled to
   'material' - they are marketing collateral, which is what this table
   held until now. Ideas are a new, separate thing sharing the table
   because they share every other column; a parallel table would
   duplicate officer/district/geo/timestamps for no gain.

4. status: 'pending' | 'saved' | 'deleted', for the admin review the
   requirement asks for. Delete is a STATUS, not a DELETE: an officer's
   submitted idea should not vanish irrecoverably because an admin
   tapped the wrong row, and 'deleted' items stay auditable.

   Existing rows are backfilled to 'saved' rather than 'pending' -
   they predate moderation and were never rejected, so dumping them all
   into a review queue would bury the genuinely new submissions.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "202608260023"
down_revision: str | None = "202608260022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. An idea need not have a picture.
    op.alter_column("marketing_materials", "image_url",
                    existing_type=sa.String(500), nullable=True)

    # 2. Voice note.
    op.add_column("marketing_materials", sa.Column("audio_url", sa.String(500), nullable=True))

    # 3. Material vs idea.
    op.add_column("marketing_materials",
                  sa.Column("submission_type", sa.String(20), nullable=False, server_default="material"))

    # 4. Admin moderation state.
    op.add_column("marketing_materials",
                  sa.Column("status", sa.String(20), nullable=False, server_default="pending"))
    op.add_column("marketing_materials", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("marketing_materials", sa.Column("reviewed_by", sa.String(200), nullable=True))

    # Pre-existing rows are collateral that was never moderated - mark
    # them saved so they do not flood the new review queue.
    op.execute("UPDATE marketing_materials SET status = 'saved' WHERE status = 'pending'")

    op.create_check_constraint(
        "ck_marketing_submission_type", "marketing_materials",
        "submission_type IN ('material', 'idea')",
    )
    op.create_check_constraint(
        "ck_marketing_status", "marketing_materials",
        "status IN ('pending', 'saved', 'deleted')",
    )
    # A submission with no image, no audio AND no text carries nothing.
    # Enforced in the database so it holds for every write path.
    op.create_check_constraint(
        "ck_marketing_has_content", "marketing_materials",
        """
        image_url IS NOT NULL
        OR audio_url IS NOT NULL
        OR (description IS NOT NULL AND length(trim(description)) > 0)
        """,
    )
    op.create_index("ix_marketing_status", "marketing_materials", ["status"])


def downgrade() -> None:
    op.drop_index("ix_marketing_status", table_name="marketing_materials")
    op.drop_constraint("ck_marketing_has_content", "marketing_materials", type_="check")
    op.drop_constraint("ck_marketing_status", "marketing_materials", type_="check")
    op.drop_constraint("ck_marketing_submission_type", "marketing_materials", type_="check")
    op.drop_column("marketing_materials", "reviewed_by")
    op.drop_column("marketing_materials", "reviewed_at")
    op.drop_column("marketing_materials", "status")
    op.drop_column("marketing_materials", "submission_type")
    op.drop_column("marketing_materials", "audio_url")
    # Rows with no image cannot satisfy the restored NOT NULL.
    op.execute("DELETE FROM marketing_materials WHERE image_url IS NULL")
    op.alter_column("marketing_materials", "image_url",
                    existing_type=sa.String(500), nullable=False)
