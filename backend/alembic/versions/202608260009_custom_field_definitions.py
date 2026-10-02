"""custom_field_definitions / custom_field_answers: generic admin-added fields, any form

Revision ID: 202608260009
Revises: 202608260008
Create Date: 2026-08-29 00:00:00

Confirmed decision (explicit, not assumed): Admin can define genuinely
new fields/sections with no existing backend column - these save into
their own JSON answer store, NOT into DailyVisitTrackerSubmitRequest's
15 typed tables. That trade-off was stated plainly and accepted: custom
answers do NOT appear in the Excel export, the Admin visit-detail panel,
farmer history, or anything else that reads from the real schema -
they're a second, parallel store living alongside it, not a replacement
for it.

Deliberately generic (form_key, not day_closure-specific) since the
same request also confirmed this should extend beyond Day Closure to
other forms across the app (Weekly Plans, Leave Requests, Farmer
Registration, ...). One system, reused per form, rather than rebuilding
this for each form individually.

Kept SEPARATE from day_closure_field_configs (202608260008), which
configures REAL fields that already map to real columns and carries
real backend_required protection - that distinction (configuring what
exists vs. defining what doesn't) is the whole reason this needs its own
tables rather than extending that one. A custom field can never be
"backend_required" since nothing in the real schema depends on it.

record_id has no foreign key, deliberately: it points at whichever
record this form's real submission produced (a visits.id for
day_closure, a plan's id for weekly_plan, etc.) - a different target
table per form_key, which a single FK column can't express. Answers are
looked up by (form_key, record_id) together, not by a database-enforced
relationship.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202608260009"
down_revision: str | None = "202608260008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "custom_field_definitions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("form_key", sa.String(50), nullable=False),
        sa.Column("field_key", sa.String(50), nullable=False),
        sa.Column("section", sa.String(100), nullable=False),
        sa.Column("label", sa.String(200), nullable=False),
        sa.Column("placeholder", sa.String(200), nullable=True),
        sa.Column("help_text", sa.String(300), nullable=True),
        # text | number | date | select | multiselect | radio | checkbox | textarea | file
        sa.Column("field_type", sa.String(30), nullable=False),
        # [{"value": "...", "label": "..."}, ...] - only meaningful for select/multiselect/radio/checkbox
        sa.Column("options", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("visible_to_field_officer", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("visible_to_sales_officer", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("visible_to_manager", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("default_value", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("form_key", "field_key", name="uq_custom_field_form_key_field_key"),
    )
    op.create_index("ix_custom_field_definitions_form_key", "custom_field_definitions", ["form_key"])

    op.create_table(
        "custom_field_answers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("form_key", sa.String(50), nullable=False),
        # See module docstring - deliberately no FK, points at a
        # different real table depending on form_key.
        sa.Column("record_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("field_key", sa.String(50), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("submitted_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("form_key", "record_id", "field_key", name="uq_custom_field_answer_record_field"),
    )
    op.create_index("ix_custom_field_answers_lookup", "custom_field_answers", ["form_key", "record_id"])


def downgrade() -> None:
    op.drop_index("ix_custom_field_answers_lookup", table_name="custom_field_answers")
    op.drop_table("custom_field_answers")
    op.drop_index("ix_custom_field_definitions_form_key", table_name="custom_field_definitions")
    op.drop_table("custom_field_definitions")
