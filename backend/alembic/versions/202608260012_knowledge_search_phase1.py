"""knowledge search phase 1: pg_trgm, crop/disease enrichment, synonyms

Revision ID: 202608260012
Revises: 202608260011
Create Date: 2026-09-01 06:00:00

Phase 1 of the internal Disease Knowledge Search system. Foundation only -
no search endpoints or UI yet, and deliberately nothing destructive: every
change here is additive, so the running application is unaffected.

Three things:

1. Enable pg_trgm. Postgres 16 (postgis/postgis:16-3.4-alpine) ships this;
   it just was never enabled. Needed for fuzzy/typo matching
   ("tomatoe" -> "tomato"). Full-text search needs no extension.

2. Enrich `crops` and `diseases`. Both existed as name-only lookup
   tables built for the Daily Visit Tracker's dropdowns (202608250001) -
   fine for picking a value from a list, but they carry none of the
   knowledge a search system needs. Notably there was NO link at all
   between a disease and the crop it affects, so "which diseases affect
   tomato" was unanswerable.

   disease.crop_id is deliberately NULLABLE: many real diseases affect
   several crops, and a single FK can't express that. Nullable now keeps
   this migration honest (no false precision, no data invented to fill a
   NOT NULL), and a proper disease_crops join table can be added later
   without rewriting anything - existing rows just keep crop_id NULL.

3. search_synonyms (spec section 26). Admin-managed and genuinely
   load-bearing here, not a nice-to-have: Postgres full-text stemming is
   English-only, so regional and transliterated terms officers actually
   type ("thakkali", "brinjal", "paddy") will never stem to their English
   equivalents on their own. This table is how that gap gets closed.
   Bidirectional by convention - the search layer expands a query in both
   directions rather than requiring both rows to be entered.

Search vectors and GIN indexes are added in Phase 2 alongside the
knowledge_cases/solutions tables, so all the indexing lands together
rather than being split across migrations.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202608260012"
down_revision: str | None = "202608260011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Seeded from the spec's own examples (section 4/26) plus the crop names
# already present in this system's master data. Kept deliberately small -
# this is a starting point admins extend from the UI, not an attempt to
# pre-load every regional term.
_SEED_SYNONYMS = [
    ("paddy", "rice"),
    ("brinjal", "eggplant"),
    ("lady finger", "okra"),
    ("ladies finger", "okra"),
    ("bhindi", "okra"),
    ("chilli", "chili"),
    ("thakkali", "tomato"),
    ("vendakkai", "okra"),
    ("kathirikai", "brinjal"),
    ("leaf yellowing", "yellow leaves"),
    ("yellowing leaves", "yellow leaves"),
    ("brown spots", "brown lesions"),
    ("circular spots", "circular lesions"),
    ("wilting", "wilt"),
    ("rotting", "rot"),
]


def upgrade() -> None:
    # --- 1. Fuzzy matching support ---
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # --- 2. Enrich crops ---
    op.add_column("crops", sa.Column("aliases", postgresql.ARRAY(sa.Text()), nullable=True))

    # --- 2b. Enrich diseases ---
    op.add_column("diseases", sa.Column("scientific_name", sa.String(200), nullable=True))
    op.add_column("diseases", sa.Column("aliases", postgresql.ARRAY(sa.Text()), nullable=True))
    op.add_column("diseases", sa.Column("crop_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("diseases", sa.Column("symptoms", sa.Text(), nullable=True))
    op.add_column("diseases", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("diseases", sa.Column("prevention", sa.Text(), nullable=True))
    op.add_column("diseases", sa.Column("management", sa.Text(), nullable=True))
    op.create_foreign_key(
        "fk_diseases_crop_id", "diseases", "crops", ["crop_id"], ["id"], ondelete="SET NULL"
    )

    # Trigram indexes for fuzzy name matching - these are what make
    # "tomatoe" find "tomato" without a full table scan.
    op.execute("CREATE INDEX ix_crops_name_trgm ON crops USING GIN (name gin_trgm_ops)")
    op.execute("CREATE INDEX ix_diseases_name_trgm ON diseases USING GIN (name gin_trgm_ops)")

    # --- 3. Admin-managed synonyms ---
    op.create_table(
        "search_synonyms",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("term", sa.String(100), nullable=False),
        sa.Column("synonym", sa.String(100), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    # Case-insensitive uniqueness enforced by the database itself, so a
    # duplicate can't slip in through concurrent admin edits.
    op.execute(
        "CREATE UNIQUE INDEX uq_search_synonyms_pair_ci "
        "ON search_synonyms (lower(term), lower(synonym))"
    )
    op.execute("CREATE INDEX ix_search_synonyms_term_lower ON search_synonyms (lower(term))")

    for term, synonym in _SEED_SYNONYMS:
        op.execute(
            sa.text("INSERT INTO search_synonyms (id, term, synonym) VALUES (gen_random_uuid(), :t, :s)")
            .bindparams(t=term, s=synonym)
        )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_search_synonyms_term_lower")
    op.execute("DROP INDEX IF EXISTS uq_search_synonyms_pair_ci")
    op.drop_table("search_synonyms")

    op.execute("DROP INDEX IF EXISTS ix_diseases_name_trgm")
    op.execute("DROP INDEX IF EXISTS ix_crops_name_trgm")

    op.drop_constraint("fk_diseases_crop_id", "diseases", type_="foreignkey")
    for col in ("management", "prevention", "description", "symptoms", "crop_id", "aliases", "scientific_name"):
        op.drop_column("diseases", col)
    op.drop_column("crops", "aliases")

    # pg_trgm is deliberately NOT dropped - other things may come to rely
    # on it, and dropping an extension is far more disruptive than
    # leaving it enabled.
