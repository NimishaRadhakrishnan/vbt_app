"""daily visit tracker: master data + normalized visit detail tables

Revision ID: 202608250001
Revises: 202608240001
Create Date: 2026-08-25 00:01:00

This is the schema foundation for the Daily Visit Tracker feature - see the
phased implementation plan in the accompanying report for what's built on
top of this vs. still to come.

Deliberately built AS AN EXTENSION of the existing `visits` /
`visit_trial_products` tables (added in 202608240001 for the mobile
Trial-field work), not a parallel system - per the spec's own instruction
not to duplicate existing visit/farmer/product/user records. `visits`
stays the anchor row (one per field visit, already has farmer_id, dealer_id,
is_trial, and the KPI columns from the earlier phase); everything below is
either master data (crops, pests, diseases, chemicals, and the small
multi-select option lists) or a satellite table hanging off visits.id for
a section of the form that doesn't fit as flat columns on visits itself
(crop profile, farm practices, health/diagnosis, trial details, sales).

Fixed-but-short option sets (farming_type, visit_purpose, demo_status,
crop_status, advisory_source, unit fields) are VARCHAR + CHECK constraints
rather than lookup tables, matching how this codebase already handles
`leave_type`, `dealer.status`, `task.status`, etc. everywhere else - a
lookup table for a genuinely fixed 4-6 value enum would be inconsistent
with the rest of the schema for no real benefit. Anything the spec called
out as needing admin-extensible master data (crops, pests, diseases,
chemicals, and the three multi-select input lists) gets a real table.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202608250001"
down_revision: str | None = "202608240001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _uuid_pk(name: str = "id"):
    return sa.Column(name, postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()"))


def upgrade() -> None:
    # ------------------------------------------------------------------
    # Master data (admin-manageable per section 35 - CRUD endpoints are
    # part of the API-layer phase, not this migration, but the tables are
    # shaped for that from the start: name + optional category + active
    # flag, nothing visit-specific baked in).
    # ------------------------------------------------------------------

    op.create_table(
        "crop_categories",
        _uuid_pk(),
        sa.Column("name", sa.String(50), nullable=False, unique=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
    )
    # Seed the 5 categories named in the spec - admin can add more later.
    op.execute(
        """
        INSERT INTO crop_categories (id, name) VALUES
        (gen_random_uuid(), 'Field'), (gen_random_uuid(), 'Fruit'),
        (gen_random_uuid(), 'Vegetable'), (gen_random_uuid(), 'Spice'),
        (gen_random_uuid(), 'Floriculture')
        """
    )

    op.create_table(
        "crops",
        _uuid_pk(),
        sa.Column("crop_category_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.ForeignKeyConstraint(["crop_category_id"], ["crop_categories.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("crop_category_id", "name", name="uq_crops_category_name"),
    )

    op.create_table(
        "crop_varieties",
        _uuid_pk(),
        sa.Column("crop_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.ForeignKeyConstraint(["crop_id"], ["crops.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("crop_id", "name", name="uq_crop_varieties_crop_name"),
    )

    op.create_table(
        "pests",
        _uuid_pk(),
        sa.Column("name", sa.String(150), nullable=False, unique=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
    )

    op.create_table(
        "diseases",
        _uuid_pk(),
        sa.Column("name", sa.String(150), nullable=False, unique=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
    )

    op.create_table(
        "chemicals",
        _uuid_pk(),
        sa.Column("name", sa.String(150), nullable=False, unique=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
    )

    op.create_table(
        "micronutrients",
        _uuid_pk(),
        sa.Column("name", sa.String(50), nullable=False, unique=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.execute(
        """
        INSERT INTO micronutrients (id, name) VALUES
        (gen_random_uuid(), 'Zinc'), (gen_random_uuid(), 'Ferrous'),
        (gen_random_uuid(), 'Borax'), (gen_random_uuid(), 'Manganese'),
        (gen_random_uuid(), 'Copper')
        """
    )

    op.create_table(
        "farm_operations",
        _uuid_pk(),
        sa.Column("name", sa.String(50), nullable=False, unique=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.execute(
        """
        INSERT INTO farm_operations (id, name) VALUES
        (gen_random_uuid(), 'Weeding'), (gen_random_uuid(), 'Herbicide spray'),
        (gen_random_uuid(), 'Earthing up'), (gen_random_uuid(), 'Mulching'),
        (gen_random_uuid(), 'Intercropping')
        """
    )

    op.create_table(
        "organic_solutions",
        _uuid_pk(),
        sa.Column("name", sa.String(50), nullable=False, unique=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.execute(
        """
        INSERT INTO organic_solutions (id, name) VALUES
        (gen_random_uuid(), 'Jeevamrutham'), (gen_random_uuid(), 'Panchagavya'),
        (gen_random_uuid(), 'Trichoderma'), (gen_random_uuid(), 'Pseudomonas'),
        (gen_random_uuid(), 'Neem oil'), (gen_random_uuid(), 'Pheromone traps')
        """
    )

    # ------------------------------------------------------------------
    # visits gets the flat, single-value fields directly (farm size,
    # farming type) - genuinely 1:1 scalars, not worth a satellite table.
    # ------------------------------------------------------------------
    op.add_column("visits", sa.Column("farm_size_value", sa.Numeric(10, 2), nullable=True))
    op.add_column("visits", sa.Column("farm_size_unit", sa.String(20), nullable=False, server_default="acres"))
    op.add_column(
        "visits",
        sa.Column(
            "farming_type",
            sa.String(30),
            nullable=True,
        ),
    )
    op.create_check_constraint(
        "ck_visits_farming_type",
        "visits",
        "farming_type IS NULL OR farming_type IN ('certified_organic', 'natural_farming', 'transitioning', 'conventional')",
    )
    # Draft support (section 26/27) - a draft is a JSON blob keyed by
    # officer, not a half-populated visits row, since most of the
    # relational tables below have required-at-submit-time columns that a
    # draft legitimately hasn't filled in yet. Converted into real rows
    # across visits + the satellite tables only at actual submit.
    op.create_table(
        "visit_drafts",
        _uuid_pk(),
        sa.Column("officer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("draft_data", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["officer_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("idx_visit_drafts_officer", "visit_drafts", ["officer_id"])

    # ------------------------------------------------------------------
    # Crop profile (1:1 with visits)
    # ------------------------------------------------------------------
    op.create_table(
        "visit_crop_profiles",
        _uuid_pk(),
        sa.Column("visit_id", postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("crop_category_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("crop_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("variety_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("variety_text", sa.String(150), nullable=True),  # fallback if not yet in master data
        sa.Column("crop_age_value", sa.Numeric(6, 1), nullable=True),
        sa.Column("crop_age_unit", sa.String(10), nullable=True),  # days | weeks | months
        sa.Column("sowing_date", sa.Date(), nullable=True),
        sa.Column("previous_crop_text", sa.String(150), nullable=True),
        sa.Column("previous_yield_value", sa.Numeric(10, 2), nullable=True),
        sa.Column("previous_yield_unit", sa.String(20), nullable=True),
        sa.ForeignKeyConstraint(["visit_id"], ["visits.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["crop_category_id"], ["crop_categories.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["crop_id"], ["crops.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["variety_id"], ["crop_varieties.id"], ondelete="SET NULL"),
        sa.CheckConstraint("crop_age_unit IS NULL OR crop_age_unit IN ('days','weeks','months')", name="ck_crop_age_unit"),
    )

    # ------------------------------------------------------------------
    # Farm practices & inputs (multi-select join tables, 1:many with visits)
    # ------------------------------------------------------------------
    op.create_table(
        "visit_nutrients",
        _uuid_pk(),
        sa.Column("visit_id", postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("n_qty", sa.Numeric(8, 2), nullable=True),
        sa.Column("p_qty", sa.Numeric(8, 2), nullable=True),
        sa.Column("k_qty", sa.Numeric(8, 2), nullable=True),
        sa.Column("npk_unit", sa.String(20), nullable=True),
        sa.Column("application_date", sa.Date(), nullable=True),
        sa.Column("frequency", sa.String(100), nullable=True),
        sa.ForeignKeyConstraint(["visit_id"], ["visits.id"], ondelete="CASCADE"),
    )

    op.create_table(
        "visit_micronutrients",
        _uuid_pk(),
        sa.Column("visit_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("micronutrient_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("quantity", sa.Numeric(8, 2), nullable=True),
        sa.Column("unit", sa.String(20), nullable=True),
        sa.ForeignKeyConstraint(["visit_id"], ["visits.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["micronutrient_id"], ["micronutrients.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("visit_id", "micronutrient_id", name="uq_visit_micronutrient"),
    )

    op.create_table(
        "visit_farm_operations",
        _uuid_pk(),
        sa.Column("visit_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("farm_operation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("performed_date", sa.Date(), nullable=True),
        sa.Column("remarks", sa.String(500), nullable=True),
        sa.ForeignKeyConstraint(["visit_id"], ["visits.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["farm_operation_id"], ["farm_operations.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("visit_id", "farm_operation_id", name="uq_visit_farm_operation"),
    )

    op.create_table(
        "visit_organic_solutions",
        _uuid_pk(),
        sa.Column("visit_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organic_solution_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("quantity", sa.Numeric(8, 2), nullable=True),
        sa.Column("unit", sa.String(20), nullable=True),
        sa.Column("application_date", sa.Date(), nullable=True),
        sa.Column("remarks", sa.String(500), nullable=True),
        sa.ForeignKeyConstraint(["visit_id"], ["visits.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organic_solution_id"], ["organic_solutions.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("visit_id", "organic_solution_id", name="uq_visit_organic_solution"),
    )

    op.create_table(
        "visit_advisory",
        _uuid_pk(),
        sa.Column("visit_id", postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("used_advisory", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("source", sa.String(20), nullable=True),  # agri_clinic | kvk | other
        sa.Column("remarks", sa.String(500), nullable=True),
        sa.ForeignKeyConstraint(["visit_id"], ["visits.id"], ondelete="CASCADE"),
        sa.CheckConstraint("source IS NULL OR source IN ('agri_clinic','kvk','other')", name="ck_visit_advisory_source"),
    )

    # ------------------------------------------------------------------
    # Crop health & pest/disease diagnosis
    # ------------------------------------------------------------------
    op.create_table(
        "visit_health",
        _uuid_pk(),
        sa.Column("visit_id", postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("crop_status", sa.String(30), nullable=False),
        sa.Column("severity", sa.SmallInteger(), nullable=True),  # 0-10; NULL/0 when status is healthy
        sa.ForeignKeyConstraint(["visit_id"], ["visits.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "crop_status IN ('healthy','mild_stress','pest_disease_affected','drought','waterlogged')",
            name="ck_visit_health_crop_status",
        ),
        sa.CheckConstraint("severity IS NULL OR (severity >= 0 AND severity <= 10)", name="ck_visit_health_severity"),
    )

    op.create_table(
        "visit_health_pests",
        _uuid_pk(),
        sa.Column("visit_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("pest_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["visit_id"], ["visits.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["pest_id"], ["pests.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("visit_id", "pest_id", name="uq_visit_health_pest"),
    )

    op.create_table(
        "visit_health_diseases",
        _uuid_pk(),
        sa.Column("visit_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("disease_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["visit_id"], ["visits.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["disease_id"], ["diseases.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("visit_id", "disease_id", name="uq_visit_health_disease"),
    )

    op.create_table(
        "visit_health_chemicals",
        _uuid_pk(),
        sa.Column("visit_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("chemical_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("chemical_name_text", sa.String(150), nullable=True),  # fallback if not yet in master data
        sa.Column("quantity", sa.String(100), nullable=True),
        sa.Column("frequency", sa.String(100), nullable=True),
        sa.ForeignKeyConstraint(["visit_id"], ["visits.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["chemical_id"], ["chemicals.id"], ondelete="SET NULL"),
    )

    # ------------------------------------------------------------------
    # Trial/demo details - extends the existing is_trial flag +
    # visit_trial_products (both from 202608240001). Only the
    # purpose/status/plot-size fields are new; product+quantity tracking
    # already exists and is reused as-is.
    # ------------------------------------------------------------------
    op.create_table(
        "visit_trial_details",
        _uuid_pk(),
        sa.Column("visit_id", postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("visit_purpose", sa.String(30), nullable=True),
        sa.Column("demo_status", sa.String(20), nullable=True),
        sa.Column("trial_plot_size_acres", sa.Numeric(6, 2), nullable=True),
        sa.ForeignKeyConstraint(["visit_id"], ["visits.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "visit_purpose IS NULL OR visit_purpose IN ('new_contact','demo_setup','routine_follow_up','field_day')",
            name="ck_visit_trial_purpose",
        ),
        sa.CheckConstraint(
            "demo_status IS NULL OR demo_status IN ('agreed','started_today','running','success','failed','converted')",
            name="ck_visit_trial_demo_status",
        ),
        sa.CheckConstraint(
            "trial_plot_size_acres IS NULL OR trial_plot_size_acres > 0",
            name="ck_visit_trial_plot_size_positive",
        ),
    )

    # Officer stock ledger (section 22/34) - admin sets opening/received;
    # remaining is computed at submit time as
    # opening + received - SUM(visit_trial_products.quantity_given for
    # that officer+product), enforced server-side so it can never go
    # negative, rather than a running-balance column that could drift out
    # of sync with the actual trial history.
    op.create_table(
        "officer_product_stock",
        _uuid_pk(),
        sa.Column("officer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("opening_stock", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("received_stock", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["officer_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("officer_id", "product_id", name="uq_officer_product_stock"),
    )

    # ------------------------------------------------------------------
    # Sales conversion
    # ------------------------------------------------------------------
    op.create_table(
        "visit_sales",
        _uuid_pk(),
        sa.Column("visit_id", postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("purchased", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("order_value", sa.Numeric(12, 2), nullable=True),
        sa.Column("conversion_status", sa.String(20), nullable=True),
        sa.ForeignKeyConstraint(["visit_id"], ["visits.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "conversion_status IS NULL OR conversion_status IN ('interested','order_placed','converted')",
            name="ck_visit_sales_conversion_status",
        ),
        sa.CheckConstraint("order_value IS NULL OR order_value >= 0", name="ck_visit_sales_order_value_nonneg"),
    )

    op.create_table(
        "visit_sale_items",
        _uuid_pk(),
        sa.Column("visit_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("quantity", sa.Numeric(10, 2), nullable=False),
        sa.Column("unit", sa.String(20), nullable=True),
        sa.ForeignKeyConstraint(["visit_id"], ["visits.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.CheckConstraint("quantity > 0", name="ck_visit_sale_items_qty_positive"),
    )

    # ------------------------------------------------------------------
    # Photos (generalizes the single photo_url_farm column already on
    # visits into a proper 1:many gallery with a type tag, per section 17)
    # ------------------------------------------------------------------
    op.create_table(
        "visit_photos",
        _uuid_pk(),
        sa.Column("visit_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("photo_url", sa.String(500), nullable=False),
        sa.Column("photo_type", sa.String(30), nullable=False, server_default="crop_condition"),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["visit_id"], ["visits.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("idx_visit_photos_visit", "visit_photos", ["visit_id"])

    # ------------------------------------------------------------------
    # Follow-up (flat scalars on visits - next_visit_date already exists
    # from the base visits table; only follow-up remarks is new)
    # ------------------------------------------------------------------
    op.add_column("visits", sa.Column("follow_up_remarks", sa.String(1000), nullable=True))


def downgrade() -> None:
    op.drop_column("visits", "follow_up_remarks")
    op.drop_index("idx_visit_photos_visit", table_name="visit_photos")
    op.drop_table("visit_photos")
    op.drop_table("visit_sale_items")
    op.drop_table("visit_sales")
    op.drop_table("officer_product_stock")
    op.drop_table("visit_trial_details")
    op.drop_table("visit_health_chemicals")
    op.drop_table("visit_health_diseases")
    op.drop_table("visit_health_pests")
    op.drop_table("visit_health")
    op.drop_table("visit_advisory")
    op.drop_table("visit_organic_solutions")
    op.drop_table("visit_farm_operations")
    op.drop_table("visit_micronutrients")
    op.drop_table("visit_nutrients")
    op.drop_table("visit_crop_profiles")
    op.drop_index("idx_visit_drafts_officer", table_name="visit_drafts")
    op.drop_table("visit_drafts")
    op.drop_constraint("ck_visits_farming_type", "visits", type_="check")
    op.drop_column("visits", "farming_type")
    op.drop_column("visits", "farm_size_unit")
    op.drop_column("visits", "farm_size_value")
    op.drop_table("organic_solutions")
    op.drop_table("farm_operations")
    op.drop_table("micronutrients")
    op.drop_table("chemicals")
    op.drop_table("diseases")
    op.drop_table("pests")
    op.drop_table("crop_varieties")
    op.drop_table("crops")
    op.drop_table("crop_categories")
