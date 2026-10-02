"""knowledge search phase 2: cases, versioned solutions, images, search vectors

Revision ID: 202608260013
Revises: 202608260012
Create Date: 2026-09-01 21:00:00

Phase 2 of the Disease Knowledge Search system - the data model. Still no
search endpoints (Phase 3); this creates the tables those will query.
Everything additive, nothing existing is altered destructively.

Design decisions worth recording:

1. SOLUTIONS ARE SEPARATE FROM CASES (spec section 12). Many cases can
   point at one verified solution - that is the entire "knowledge reuse"
   premise (section 9). Folding solution text into the case row would
   mean the same advice duplicated across dozens of rows with no single
   place to correct it.

2. SOLUTION VERSIONING VIA A SEPARATE TABLE (section 13). `solutions`
   holds identity and the pointer to the current version;
   `solution_versions` holds the actual text, immutably, one row per
   version. A case stores `solution_version_id`, NOT just solution_id -
   so a case from six months ago still shows the exact advice the
   officer was actually given, even after an admin has since revised it.
   Storing only solution_id would silently rewrite history.

3. NO `is_deleted` ON solution_versions. A version is an immutable
   historical fact; superseding it is what `solutions.current_version_id`
   moving forward expresses. Deleting one would orphan the cases that
   reference it.

4. SEARCH VECTORS ARE GENERATED COLUMNS. Postgres maintains them
   automatically on insert/update - no trigger to write, no application
   code that can forget to refresh them, no drift between the row and
   its index. Weighted A/B/C/D so the ranking in Phase 3 can reflect
   that a disease name matching matters more than a stray note word.

5. `verification_status` uses the spec's exact five states (section 7).
   Only 'verified' is ever recommended as official; the search layer
   (Phase 3) enforces that, and this table records it.

The cold-start problem: `knowledge_cases.source_crop_issue_id` lets an
admin promote an existing resolved `crop_issues` row (which already
holds real officer questions and expert replies) into verified
knowledge, rather than launching with an empty database. Nullable - most
cases will be created directly.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202608260013"
down_revision: str | None = "202608260012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_VERIFICATION_STATES = "('draft','pending_review','verified','rejected','archived')"


def upgrade() -> None:
    # Sequence backing the human-facing CASE-00125 reference. Created
    # before knowledge_cases, since that table's default calls nextval()
    # on it - a column default referencing a missing sequence fails at
    # migration time, not at first insert.
    op.execute("CREATE SEQUENCE IF NOT EXISTS knowledge_case_number_seq START 1")

    # --- Solutions: identity + pointer to current version ---
    op.create_table(
        "solutions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("disease_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("diseases.id", ondelete="SET NULL"), nullable=True),
        sa.Column("crop_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("crops.id", ondelete="SET NULL"), nullable=True),
        # Set after the first version row exists (chicken/egg), hence nullable.
        sa.Column("current_version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("usage_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("helpful_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("not_helpful_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("verified_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(f"status IN {_VERIFICATION_STATES}", name="ck_solutions_status"),
    )

    # --- Solution versions: immutable text, one row per revision ---
    op.create_table(
        "solution_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("solution_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("solutions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("solution_text", sa.Text(), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=True),
        sa.Column("precautions", sa.Text(), nullable=True),
        sa.Column("source_reference", sa.String(500), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("solution_id", "version_number", name="uq_solution_version_number"),
    )
    op.create_foreign_key(
        "fk_solutions_current_version", "solutions", "solution_versions",
        ["current_version_id"], ["id"], ondelete="SET NULL",
    )

    # --- Knowledge cases (spec section 10) ---
    op.create_table(
        "knowledge_cases",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        # Human-facing reference (CASE-00125 in the spec's example).
        # Generated from a sequence so it is stable, readable, and never
        # collides - unlike deriving it from a row count.
        sa.Column("case_number", sa.Integer(), server_default=sa.text("nextval('knowledge_case_number_seq')"), nullable=False, unique=True),
        sa.Column("officer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("crop_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("crops.id", ondelete="SET NULL"), nullable=True),
        sa.Column("disease_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("diseases.id", ondelete="SET NULL"), nullable=True),
        # Free text kept alongside the FKs on purpose: an officer's own
        # wording is the most valuable search signal, and the crop or
        # disease may not exist in master data when the case is filed.
        sa.Column("crop_text", sa.String(200), nullable=True),
        sa.Column("disease_text", sa.String(200), nullable=True),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("symptoms", sa.Text(), nullable=True),
        sa.Column("solution_used", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("district", sa.String(100), nullable=True),
        # Points at the exact version shown/used - see docstring note 2.
        sa.Column("solution_version_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("solution_versions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("verification_status", sa.String(20), nullable=False, server_default="pending_review"),
        sa.Column("verified_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("usage_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        # Cold start: promote an existing resolved crop_issues row.
        sa.Column("source_crop_issue_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("crop_issues.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(f"verification_status IN {_VERIFICATION_STATES}", name="ck_knowledge_cases_status"),
    )

    # --- Case images (spec section 16: leaf / plant / closeup / fruit / stem) ---
    op.create_table(
        "case_images",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("knowledge_cases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("image_url", sa.String(500), nullable=False),
        sa.Column("image_type", sa.String(20), nullable=True),
        sa.Column("caption", sa.String(300), nullable=True),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "image_type IS NULL OR image_type IN ('leaf','plant','closeup','fruit','stem','other')",
            name="ck_case_images_type",
        ),
    )
    op.create_index("ix_case_images_case_id", "case_images", ["case_id"])

    # --- Generated search vectors (see docstring note 4) ---
    # Weights: A = the officer's own question (closest to how the next
    # officer will phrase theirs), B = symptoms, C = crop/disease text,
    # D = notes.
    op.execute("""
        ALTER TABLE knowledge_cases ADD COLUMN search_vector tsvector
        GENERATED ALWAYS AS (
            setweight(to_tsvector('english', coalesce(question, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(symptoms, '')), 'B') ||
            setweight(to_tsvector('english', coalesce(crop_text, '') || ' ' || coalesce(disease_text, '')), 'C') ||
            setweight(to_tsvector('english', coalesce(notes, '')), 'D')
        ) STORED
    """)
    op.execute("CREATE INDEX ix_knowledge_cases_search ON knowledge_cases USING GIN (search_vector)")

    op.execute("""
        ALTER TABLE diseases ADD COLUMN search_vector tsvector
        GENERATED ALWAYS AS (
            setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(scientific_name, '')), 'B') ||
            setweight(to_tsvector('english', coalesce(symptoms, '')), 'B') ||
            setweight(to_tsvector('english', coalesce(description, '')), 'D')
        ) STORED
    """)
    op.execute("CREATE INDEX ix_diseases_search ON diseases USING GIN (search_vector)")

    # Filter/sort indexes the Phase 3 search will lean on.
    op.create_index("ix_knowledge_cases_status", "knowledge_cases", ["verification_status"])
    op.create_index("ix_knowledge_cases_crop", "knowledge_cases", ["crop_id"])
    op.create_index("ix_knowledge_cases_disease", "knowledge_cases", ["disease_id"])
    op.execute("CREATE INDEX ix_knowledge_cases_question_trgm ON knowledge_cases USING GIN (question gin_trgm_ops)")
    op.create_index("ix_solutions_status", "solutions", ["status"])


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_solutions_status")
    op.execute("DROP INDEX IF EXISTS ix_knowledge_cases_question_trgm")
    op.execute("DROP INDEX IF EXISTS ix_knowledge_cases_disease")
    op.execute("DROP INDEX IF EXISTS ix_knowledge_cases_crop")
    op.execute("DROP INDEX IF EXISTS ix_knowledge_cases_status")
    op.execute("DROP INDEX IF EXISTS ix_diseases_search")
    op.execute("ALTER TABLE diseases DROP COLUMN IF EXISTS search_vector")
    op.execute("DROP INDEX IF EXISTS ix_knowledge_cases_search")
    op.drop_index("ix_case_images_case_id", table_name="case_images")
    op.drop_table("case_images")
    op.drop_constraint("fk_solutions_current_version", "solutions", type_="foreignkey")
    op.drop_table("knowledge_cases")
    op.drop_table("solution_versions")
    op.drop_table("solutions")
    op.execute("DROP SEQUENCE IF EXISTS knowledge_case_number_seq")
