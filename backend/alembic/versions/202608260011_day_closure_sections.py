"""day_closure_sections: sections become real, renameable/reorderable/deletable data

Revision ID: 202608260011
Revises: 202608260010
Create Date: 2026-08-29 04:00:00

Previously the 5 section headers ("1. Basic Visit Details", etc.) were a
hardcoded SECTION_LABELS constant in DayClosureFormBuilder.tsx - Admin
had no way to rename, reorder, or add one. This table makes sections
real, admin-manageable rows, seeded with the exact 5 existing labels/
order so nothing changes for an Admin who never touches this.

Deletion rule (enforced in the router, not here): a section can only be
deleted if it contains ZERO real (day_closure_field_configs) fields -
which in practice means only sections created via "Add Section" can
ever be deleted, since all 5 original sections were seeded with real
fields tied to actual DailyVisitTrackerSubmitRequest columns. This is
deliberately stricter than "just check for backend_required fields":
a real field that ISN'T backend_required (like "NPK Dosage") still maps
to an actual Pydantic field and satisfies real farm data - it was never
meant to be deletable, only disable-able, so a section containing one
is never a deletion candidate either, not just the ones containing the
hard-locked fields.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202608260011"
down_revision: str | None = "202608260010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SEED_SECTIONS = [
    ("basic_visit_details", "1. Basic Visit Details", 10),
    ("crop_farming_profile", "2. Crop & Farming Profile", 20),
    ("farm_practices_inputs", "3. Farm Practices & Inputs", 30),
    ("crop_health_diagnosis", "4. Crop Health & Pest Diagnosis", 40),
    ("business_demo_tracking", "5. Business & Demo Tracking", 50),
]


def upgrade() -> None:
    op.create_table(
        "day_closure_sections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("section_key", sa.String(100), nullable=False, unique=True),
        sa.Column("label", sa.String(200), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_original", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    for key, label, order in _SEED_SECTIONS:
        op.execute(
            sa.text("""
                INSERT INTO day_closure_sections (id, section_key, label, display_order, is_original)
                VALUES (gen_random_uuid(), :key, :label, :order, true)
            """).bindparams(key=key, label=label, order=order)
        )


def downgrade() -> None:
    op.drop_table("day_closure_sections")
