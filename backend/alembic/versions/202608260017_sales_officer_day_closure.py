"""sales officer day closure: closure_type discriminator + sales detail table

Revision ID: 202608260017
Revises: 202608260016
Create Date: 2026-09-05 06:00:00

Adds Sales Officer day closure by EXTENDING the existing day_closures
table rather than creating a parallel one - the structure already keys
on (officer_id, date) with no role column, and already carries a
UNIQUE(officer_id, date) constraint that prevents duplicate closures for
any officer regardless of role. A second table would have duplicated
that constraint, the admin CRUD endpoints, and the logout-gate logic for
no benefit.

Why a discriminator was needed at all
-------------------------------------
The existing closure requires a DailyVisitTrackerSubmitRequest - farmer,
crop, sowing date, pest/disease diagnosis, severity. That is a farm
agronomy visit. A Sales Officer's day is dealers, orders, collections
and stock, and `farming_type` / `crop_status` / `farm_size_value` are
non-optional on that request, so a Sales Officer literally could not
submit a valid payload. They were being gated on submitting something
impossible.

So: `closure_type` distinguishes the two, `visit_id` becomes NULLABLE
(a sales closure has no farm visit to point at), and sales specifics
live in their own satellite table keyed to the closure. Field Officer
behaviour is completely unchanged - existing rows are backfilled to
'field_visit', which is exactly what they are.

Admin editability
-----------------
The field list below is seeded into day_closure_field_configs (the
existing Form Builder backing table) with section 'sales_*' keys, so an
admin can relabel, reorder, require/unrequire and disable any of them
from the Builder already built for the field-officer form. Genuinely NEW
fields an admin invents go through the existing generic
custom_field_definitions system under form_key='sales_day_closure' -
no new admin machinery for either case.

`backend_required` is set true only where the backend genuinely cannot
accept a null: dealer name, district and visit purpose anchor the record
and everything else is optional-by-design, so an admin can tune the form
to how their team actually works without ever breaking submission.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202608260017"
down_revision: str | None = "202608260016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (field_key, section, label, field_type, is_required, order, backend_required)
# Mirrors the source form supplied for this feature. Required-ness
# follows that form's own asterisks, except where marked backend_required.
_SALES_FIELDS = [
    # Section 1 - visit identification
    ("sales_district", "sales_visit_details", "District", "select", True, 10, True),
    ("sales_visit_date", "sales_visit_details", "Date of Update", "date", True, 20, False),
    ("sales_dealer_name", "sales_visit_details", "Dealer / Distributor Name", "text", True, 30, True),
    ("sales_village", "sales_visit_details", "Village / Location", "text", True, 40, False),
    ("sales_dealer_contact", "sales_visit_details", "Contact Number (Dealer/Distributor)", "text", True, 50, False),
    ("sales_visit_purpose", "sales_visit_details", "Visit Purpose", "select", True, 60, True),
    # Section 2 - commercial outcome
    ("sales_order_booked", "sales_commercial", "Was an Order Booked?", "radio", True, 70, False),
    ("sales_order_value", "sales_commercial", "Order Value (Rs)", "number", False, 80, False),
    ("sales_amount_collected", "sales_commercial", "Amount Collected from Dealer (Rs)", "number", True, 90, False),
    ("sales_new_dealer", "sales_commercial", "Is This a New Dealer Onboarded Today?", "text", True, 100, False),
    # Section 3 - field and market intelligence
    ("sales_fo_review", "sales_intel", "Did You Review/Accompany an FO Field Visit Today?", "radio", True, 110, False),
    ("sales_competitor_activity", "sales_intel", "Any Competitor Activity Observed?", "textarea", True, 120, False),
    ("sales_competitor_photos", "sales_intel", "Competitor Activity Photos", "file", False, 130, False),
    ("sales_stock_status", "sales_intel", "Dealer Stock Status", "radio", True, 140, False),
    # Section 4 - wrap up
    ("sales_day_rating", "sales_wrapup", "Rating of Visit / Day (1-5)", "radio", False, 150, False),
    ("sales_remarks", "sales_wrapup", "Remarks / Next Follow-up Plan", "textarea", True, 160, False),
    ("sales_dealer_photos", "sales_wrapup", "Dealer Shop Photo", "file", True, 170, False),
]

_SALES_SECTIONS = [
    ("sales_visit_details", "1. Visit & Dealer Details", 100),
    ("sales_commercial", "2. Orders & Collection", 110),
    ("sales_intel", "3. Field & Market Intelligence", 120),
    ("sales_wrapup", "4. Rating & Follow-up", 130),
]

# Option sets for the select/radio fields, managed afterwards through the
# existing enum_field_options admin editor (202608260010) so admins can
# add or retire a visit purpose without a migration.
_SALES_OPTIONS = [
    ("sales_visit_purpose", "dealer_visit", "Dealer Visit", 10),
    ("sales_visit_purpose", "stock_audit", "Stock Audit", 20),
    ("sales_visit_purpose", "order_booking", "Order Booking", 30),
    ("sales_visit_purpose", "collection", "Collection", 40),
    ("sales_visit_purpose", "fo_field_review", "FO Field Review", 50),
    ("sales_visit_purpose", "new_dealer_onboarding", "New Dealer Onboarding", 60),
    ("sales_visit_purpose", "competitor_intel", "Competitor Intel", 70),
    ("sales_visit_purpose", "other", "Other", 80),
    ("sales_stock_status", "adequate", "Adequate Stock", 10),
    ("sales_stock_status", "low_reorder", "Low Stock - Reorder Needed", 20),
    ("sales_stock_status", "out_of_stock", "Out of Stock", 30),
    ("sales_stock_status", "not_applicable", "Not Applicable", 40),
]


def upgrade() -> None:
    # --- 1. Discriminator on the shared table ---
    op.add_column(
        "day_closures",
        sa.Column("closure_type", sa.String(20), nullable=False, server_default="field_visit"),
    )
    op.create_check_constraint(
        "ck_day_closures_type", "day_closures",
        "closure_type IN ('field_visit', 'sales_activity')",
    )
    # A sales closure has no farm visit to reference. Existing rows are
    # untouched and keep their visit_id.
    op.alter_column("day_closures", "visit_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True)

    # --- 2. Sales-specific detail, keyed 1:1 to the closure ---
    op.create_table(
        "sales_closure_details",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("closure_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("day_closures.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("district", sa.String(100), nullable=False),
        sa.Column("visit_date", sa.Date(), nullable=True),
        sa.Column("dealer_name", sa.String(200), nullable=False),
        # Nullable FK: the dealer may not be in the dealers table yet
        # (new onboarding), and blocking the closure on that would be
        # exactly the kind of impossible gate this migration removes.
        sa.Column("dealer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("dealers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("village", sa.String(200), nullable=True),
        sa.Column("dealer_contact", sa.String(50), nullable=True),
        sa.Column("visit_purpose", sa.String(50), nullable=False),
        sa.Column("order_booked", sa.Boolean(), nullable=True),
        sa.Column("order_value", sa.Numeric(12, 2), nullable=True),
        sa.Column("amount_collected", sa.Numeric(12, 2), nullable=True),
        sa.Column("new_dealer_details", sa.Text(), nullable=True),
        sa.Column("reviewed_fo_visit", sa.Boolean(), nullable=True),
        sa.Column("competitor_activity", sa.Text(), nullable=True),
        sa.Column("stock_status", sa.String(30), nullable=True),
        sa.Column("day_rating", sa.Integer(), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("day_rating IS NULL OR (day_rating >= 1 AND day_rating <= 5)", name="ck_sales_closure_rating"),
    )

    # Photos: reuses the same shape as case_images rather than inventing
    # a third image-attachment pattern.
    op.create_table(
        "sales_closure_images",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("closure_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("day_closures.id", ondelete="CASCADE"), nullable=False),
        sa.Column("image_url", sa.String(500), nullable=False),
        sa.Column("image_type", sa.String(20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "image_type IS NULL OR image_type IN ('dealer_shop','competitor','other')",
            name="ck_sales_closure_image_type",
        ),
    )
    op.create_index("ix_sales_closure_images_closure", "sales_closure_images", ["closure_id"])

    # --- 3. Make every field admin-editable via the existing Form Builder ---
    for key, section, label, ftype, required, order, backend_req in _SALES_FIELDS:
        op.execute(
            sa.text("""
                INSERT INTO day_closure_field_configs
                    (id, field_key, section, label, field_type, is_required, display_order,
                     backend_required, visible_to_field_officer, visible_to_sales_officer)
                VALUES (gen_random_uuid(), :k, :s, :l, :t, :r, :o, :br, false, true)
            """).bindparams(k=key, s=section, l=label, t=ftype, r=required, o=order, br=backend_req)
        )
        # Same row into the defaults table, so "Restore Defaults" in the
        # Builder resets these correctly instead of wiping them.
        op.execute(
            sa.text("""
                INSERT INTO day_closure_field_config_defaults
                    (field_key, section, label, field_type, is_required, display_order, backend_required)
                VALUES (:k, :s, :l, :t, :r, :o, :br)
            """).bindparams(k=key, s=section, l=label, t=ftype, r=required, o=order, br=backend_req)
        )

    for key, label, order in _SALES_SECTIONS:
        op.execute(
            sa.text("""
                INSERT INTO day_closure_sections (id, section_key, label, display_order, is_original)
                VALUES (gen_random_uuid(), :k, :l, :o, true)
            """).bindparams(k=key, l=label, o=order)
        )

    for field_name, value, label, order in _SALES_OPTIONS:
        op.execute(
            sa.text("""
                INSERT INTO enum_field_options (id, field_name, value, label, display_order)
                VALUES (gen_random_uuid(), :f, :v, :l, :o)
            """).bindparams(f=field_name, v=value, l=label, o=order)
        )


def downgrade() -> None:
    for field_name, value, _l, _o in _SALES_OPTIONS:
        op.execute(
            sa.text("DELETE FROM enum_field_options WHERE field_name = :f AND value = :v")
            .bindparams(f=field_name, v=value)
        )
    for key, _l, _o in _SALES_SECTIONS:
        op.execute(sa.text("DELETE FROM day_closure_sections WHERE section_key = :k").bindparams(k=key))
    for key, *_rest in _SALES_FIELDS:
        op.execute(sa.text("DELETE FROM day_closure_field_config_defaults WHERE field_key = :k").bindparams(k=key))
        op.execute(sa.text("DELETE FROM day_closure_field_configs WHERE field_key = :k").bindparams(k=key))

    op.drop_index("ix_sales_closure_images_closure", table_name="sales_closure_images")
    op.drop_table("sales_closure_images")
    op.drop_table("sales_closure_details")
    op.drop_constraint("ck_day_closures_type", "day_closures", type_="check")
    op.drop_column("day_closures", "closure_type")
    # visit_id is deliberately left nullable - restoring NOT NULL would
    # fail if any sales closure rows still exist, and a looser
    # constraint is harmless to the field-visit path.
