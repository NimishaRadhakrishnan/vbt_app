"""knowledge search phase 3: search history and unanswered searches

Revision ID: 202608260014
Revises: 202608260013
Create Date: 2026-09-03 06:00:00

Phase 3 tables. The search engine itself needs no schema (it queries the
Phase 2 tables and their generated vectors); these two exist to make the
system improve over time rather than just answer.

`search_history` (spec section 20) - what officers searched, what came
back, what they opened. Used to spot phrasing the engine handles badly.

`unanswered_searches` (spec section 24) - in my view the highest-value
table in this whole system. Every search that returns nothing useful is
recorded and COUNTED, so admins see exactly which knowledge gaps are
being hit repeatedly and can fill the most-requested ones first, rather
than guessing at what to document.

`normalized_query` is stored alongside the raw text specifically so
repeats collapse into one row with a rising count: "white patches on
banana leaves" and "banana leaves have white patches" are the same gap
and should not appear as two separate one-off entries.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202608260014"
down_revision: str | None = "202608260013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "search_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("officer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("query", sa.Text(), nullable=False),
        sa.Column("result_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("top_relevance_band", sa.String(20), nullable=True),
        sa.Column("selected_case_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("knowledge_cases.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_search_history_officer", "search_history", ["officer_id"])
    op.create_index("ix_search_history_created", "search_history", ["created_at"])

    op.create_table(
        "unanswered_searches",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("normalized_query", sa.Text(), nullable=False, unique=True),
        # The first raw phrasing seen, kept so an admin reading the queue
        # sees how an officer actually asked rather than a token list.
        sa.Column("sample_query", sa.Text(), nullable=False),
        sa.Column("search_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("last_searched_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        # Set once an admin turns this gap into real knowledge, so the
        # queue shows only what is still outstanding.
        sa.Column("resolved_case_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("knowledge_cases.id", ondelete="SET NULL"), nullable=True),
        sa.Column("is_resolved", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_unanswered_unresolved", "unanswered_searches", ["is_resolved", "search_count"])


def downgrade() -> None:
    op.drop_index("ix_unanswered_unresolved", table_name="unanswered_searches")
    op.drop_table("unanswered_searches")
    op.drop_index("ix_search_history_created", table_name="search_history")
    op.drop_index("ix_search_history_officer", table_name="search_history")
    op.drop_table("search_history")
