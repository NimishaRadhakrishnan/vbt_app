"""option descriptions: requires_description flag + sales visit_purpose other text

Revision ID: 202608260019
Revises: 202608260018
Create Date: 2026-09-07 05:00:00

Approved requirement: whenever an officer picks an option that needs
explaining ("Other", and any admin-created equivalent), the form must
demand a short description and store it.

Why a FLAG rather than hardcoding value == 'other'
--------------------------------------------------
Admins can add and retire option values at runtime through
enum_field_options (approved earlier). A hardcoded 'other' check would
silently miss an admin-created "Miscellaneous" or "Others" - the
description box simply would not appear, and the detail would be lost
with no error. The flag makes "does this option need explaining?" a
property of the option itself, which is the only place that scales to
options this migration cannot know about.

Backfilled to true for the existing 'other' values so current behaviour
is preserved without an admin having to go and tick anything.

New column
----------
sales_closure_details.visit_purpose_other_text - the audit found this
was the one gap with NO storage at all: a Sales Officer could pick
"Other" as their visit purpose and the explanation had nowhere to go.
Every other affected field already had a column (status_other_text,
crop_category_other_text, pest_other_text, disease_other_text,
visit_farm_operations.other_text), so those are reused rather than
duplicated.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "202608260019"
down_revision: str | None = "202608260018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "enum_field_options",
        sa.Column("requires_description", sa.Boolean(), nullable=False, server_default="false"),
    )

    # Preserve current behaviour: every existing "other"-style option
    # already behaved as one needing explanation, so mark them now
    # rather than making an admin re-tick each one after deploy.
    op.execute(
        """
        UPDATE enum_field_options
        SET requires_description = true
        WHERE lower(value) IN ('other', 'others', 'miscellaneous')
        """
    )

    # The one field with no storage at all - see module docstring.
    op.add_column(
        "sales_closure_details",
        sa.Column("visit_purpose_other_text", sa.String(300), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sales_closure_details", "visit_purpose_other_text")
    op.drop_column("enum_field_options", "requires_description")
