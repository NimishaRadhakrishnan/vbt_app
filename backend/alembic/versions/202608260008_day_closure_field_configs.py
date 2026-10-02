"""day_closure_field_configs: admin-configurable form field metadata

Revision ID: 202608260008
Revises: 202608260007
Create Date: 2026-08-26 06:00:00

Backs the Admin Page Builder for the Day Closure / Daily Visit Tracker
form (frontend/components/DayClosureForm.tsx). Deliberately scoped to
configuring the ~27 fields that ALREADY exist and already save correctly
through DailyVisitTrackerSubmitRequest/submit_daily_visit() - label,
placeholder, help text, required/optional, enabled/disabled, display
order, and per-role (Field Officer / Sales Officer) visibility.

NOT in scope, and deliberately so: admin-invented arbitrary new fields
with no backend column to write to. DailyVisitTrackerSubmitRequest is a
strongly-typed Pydantic model over 15 real database tables, shared by
both the officer's own submission flow and this admin config layer -
a field with nowhere to be stored can't be "saved" in any meaningful
sense without a parallel schema-free store, which is a separate,
larger design decision than this migration makes.

Safety rail: some fields are non-Optional in
DailyVisitTrackerSubmitRequest (farming_type, crop_status, and
farm_size_value - confirmed by walking the actual Pydantic field
definitions, not assumed) - if Admin could disable or un-require these,
every submission would start failing Pydantic validation. `backend_required`
marks these three; the admin CRUD endpoint (day_closure_config_router.py)
refuses to set is_enabled=false or is_required=false on any row where
backend_required=true, rather than trusting the UI alone to prevent it.

Seeded to reproduce today's form exactly (same fields, same order, same
required-ness, same labels) - so a fresh Admin who never touches the
Page Builder gets byte-for-byte the current officer experience.

Restore Defaults: a separate `day_closure_field_config_defaults` table
(same shape, populated with these exact same seed rows) rather than a
hardcoded list duplicated in the router - one source of truth for "what
is the default," so it can't silently drift from what this migration
actually seeds.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202608260008"
down_revision: str | None = "202608260007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "day_closure_field_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("field_key", sa.String(50), nullable=False, unique=True),
        sa.Column("section", sa.String(50), nullable=False),
        sa.Column("label", sa.String(200), nullable=False),
        sa.Column("placeholder", sa.String(200), nullable=True),
        sa.Column("help_text", sa.String(300), nullable=True),
        sa.Column("field_type", sa.String(30), nullable=False),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("visible_to_field_officer", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("visible_to_sales_officer", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("default_value", sa.Text(), nullable=True),
        # Non-Optional in DailyVisitTrackerSubmitRequest - disabling or
        # un-requiring these would break every submission. See module
        # docstring.
        sa.Column("backend_required", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # Reference table for Restore Defaults - same shape, minus the
    # live-only bookkeeping columns (updated_by/updated_at don't mean
    # anything for a static reference row).
    op.create_table(
        "day_closure_field_config_defaults",
        sa.Column("field_key", sa.String(50), primary_key=True),
        sa.Column("section", sa.String(50), nullable=False),
        sa.Column("label", sa.String(200), nullable=False),
        sa.Column("placeholder", sa.String(200), nullable=True),
        sa.Column("help_text", sa.String(300), nullable=True),
        sa.Column("field_type", sa.String(30), nullable=False),
        sa.Column("is_required", sa.Boolean(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("backend_required", sa.Boolean(), nullable=False),
    )

    # (field_key, section, label, placeholder, field_type, is_required, display_order, backend_required)
    seed_rows = [
        # Section 1 - Basic Visit Details
        ("farmer_name", "basic_visit_details", "Farmer Name", None, "text", True, 10, False),
        ("farmer_phone", "basic_visit_details", "Contact Number", None, "text", True, 20, False),
        ("district", "basic_visit_details", "District", None, "select", True, 30, False),
        ("village", "basic_visit_details", "Village/Block", None, "text", True, 40, False),
        ("farm_size", "basic_visit_details", "Total Farm Area (acres)", None, "number", True, 50, True),
        ("visit_date", "basic_visit_details", "Date of Visit", None, "date", True, 60, False),
        # Section 2 - Crop & Farming Profile
        ("crop_category", "crop_farming_profile", "Crop Category", None, "select", True, 70, False),
        ("crop_name", "crop_farming_profile", "Crop Name", None, "select", True, 80, False),
        ("variety", "crop_farming_profile", "Variety/Hybrid", "Type variety name", "text", True, 90, False),
        ("crop_age", "crop_farming_profile", "Age of Crop", None, "number", False, 100, False),
        ("sowing_date", "crop_farming_profile", "Sowing/Planting Date", None, "date", False, 110, False),
        ("previous_crop", "crop_farming_profile", "Previous Season Crop & Yield", "e.g. Paddy, 25 bags/acre", "text", False, 120, False),
        ("farming_type", "crop_farming_profile", "Farming Type", None, "radio", True, 130, True),
        # Section 3 - Farm Practices & Inputs
        ("npk_dosage", "farm_practices_inputs", "NPK Dosage (N / P / K, kg)", None, "text", False, 140, False),
        ("micronutrients", "farm_practices_inputs", "Micronutrients Applied", None, "multiselect", False, 150, False),
        ("operations", "farm_practices_inputs", "Intercultural Operations Done", None, "multiselect", False, 160, False),
        ("organic_solutions", "farm_practices_inputs", "Organic / IPM Solutions Used", None, "multiselect", False, 170, False),
        ("advisory", "farm_practices_inputs", "Consulting Agri-Clinic / KVK?", None, "radio", False, 180, False),
        # Section 4 - Crop Health & Pest Diagnosis
        ("crop_status", "crop_health_diagnosis", "Present Health Status", None, "radio", True, 190, True),
        ("pests", "crop_health_diagnosis", "Pests Observed", None, "multiselect", False, 200, False),
        ("diseases", "crop_health_diagnosis", "Diseases Observed", None, "multiselect", False, 210, False),
        ("chemicals", "crop_health_diagnosis", "Pesticide/Chemical Currently Used", None, "text", False, 220, False),
        ("severity", "crop_health_diagnosis", "Severity Level (1-10)", None, "radio", False, 230, False),
        ("photos", "crop_health_diagnosis", "Photo Upload (Crop Condition)", None, "file", False, 240, False),
        # Section 5 - Business & Demo Tracking
        ("visit_purpose", "business_demo_tracking", "Visit Purpose", None, "select", True, 250, False),
        ("demo_stage", "business_demo_tracking", "Demo / Trial Stage at This Farm Today", None, "select", True, 260, False),
        ("trial_plot_size", "business_demo_tracking", "Area Under Demo/Trial (acres)", "e.g. 0.5", "number", False, 270, False),
        ("purchased", "business_demo_tracking", "Did Farmer Purchase?", None, "radio", False, 280, False),
        ("order_value", "business_demo_tracking", "Order Value (₹)", None, "number", False, 290, False),
    ]

    for key, section, label, placeholder, ftype, required, order, backend_req in seed_rows:
        op.execute(
            sa.text("""
                INSERT INTO day_closure_field_configs
                    (id, field_key, section, label, placeholder, field_type, is_required, display_order, backend_required)
                VALUES
                    (gen_random_uuid(), :key, :section, :label, :placeholder, :ftype, :required, :order, :backend_req)
            """).bindparams(
                key=key, section=section, label=label, placeholder=placeholder,
                ftype=ftype, required=required, order=order, backend_req=backend_req,
            )
        )
        op.execute(
            sa.text("""
                INSERT INTO day_closure_field_config_defaults
                    (field_key, section, label, placeholder, field_type, is_required, display_order, backend_required)
                VALUES
                    (:key, :section, :label, :placeholder, :ftype, :required, :order, :backend_req)
            """).bindparams(
                key=key, section=section, label=label, placeholder=placeholder,
                ftype=ftype, required=required, order=order, backend_req=backend_req,
            )
        )


def downgrade() -> None:
    op.drop_table("day_closure_field_config_defaults")
    op.drop_table("day_closure_field_configs")
