"""sales officer module: dealer credit/payments, stock adjustments, marketing

Revision ID: 202608250003
Revises: 202608250002
Create Date: 2026-08-25 02:00:00

Deliberately reuses rather than duplicates:
- dealers (extended with the extra registration fields section 3 asks
  for, plus assigned_sales_officer_id) - not a new "SalesOfficerDealer"
  table.
- dealer_orders + order_items (already support multi-product purchases
  with a total_amount - section 6 needed zero new tables) - extended
  only with payment_deadline/payment_terms.
- officer_product_stock (added earlier for the Field Officer Trial
  feature - already officer+product scoped) - extended with
  current_quantity for "My Stock" (section 16-23), rather than a new
  SalesOfficerStock table, since both features are fundamentally the
  same question: how much of this product does this officer have.
- notifications (existing infra) - payment reminders (section 9/31) get
  written there at read/generation time, not into a new table.

New, because nothing existing covers them:
- dealer_payments: append-only payment ledger (section 13/15's explicit
  "never overwrite, always add a new transaction" requirement - the
  entire reason this can't just be an amount_paid column on
  dealer_orders).
- dealer_payment_deadline_history: audit trail for deadline extensions
  (section 14).
- officer_stock_adjustments: append-only ledger for "My Stock" changes
  (section 19/22 - same never-overwrite principle as payments).
- marketing_categories + marketing_materials (section 24-28).
- payment_reminder_schedule: admin-configurable reminder days (section 9).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202608250003"
down_revision: str | None = "202608250002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _uuid_pk(name: str = "id"):
    return sa.Column(name, postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()"))


def upgrade() -> None:
    # ------------------------------------------------------------------
    # Dealer registration fields (section 3) + assigned officer
    # ------------------------------------------------------------------
    op.add_column("dealers", sa.Column("alternate_contact", sa.String(50), nullable=True))
    op.add_column("dealers", sa.Column("state", sa.String(100), nullable=True))
    op.add_column("dealers", sa.Column("pin_code", sa.String(10), nullable=True))
    op.add_column("dealers", sa.Column("gst_number", sa.String(20), nullable=True))
    op.add_column("dealers", sa.Column("dealer_type", sa.String(50), nullable=True))
    op.add_column("dealers", sa.Column("remarks", sa.String(1000), nullable=True))
    # requested_by already records who created the dealer (existing
    # column) - assigned_sales_officer_id is deliberately a separate
    # column rather than reusing requested_by, since section 3/34 treat
    # "who registered this" and "who owns this account going forward" as
    # potentially different facts an admin can reassign later, even
    # though they start out equal at registration time.
    op.add_column("dealers", sa.Column("assigned_sales_officer_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_dealers_assigned_sales_officer", "dealers", "users", ["assigned_sales_officer_id"], ["id"], ondelete="SET NULL"
    )
    op.create_index("idx_dealers_assigned_officer", "dealers", ["assigned_sales_officer_id"])
    op.create_index("idx_dealers_gst_number", "dealers", ["gst_number"])

    # ------------------------------------------------------------------
    # Dealer order payment terms (section 7/8) - amount_paid/outstanding
    # are deliberately NOT columns here; they're always computed from
    # dealer_payments below, per section 7's explicit "do not rely on
    # manual entry" instruction.
    # ------------------------------------------------------------------
    op.add_column("dealer_orders", sa.Column("payment_deadline", sa.Date(), nullable=True))
    op.add_column("dealer_orders", sa.Column("payment_terms", sa.String(200), nullable=True))

    # ------------------------------------------------------------------
    # Payment ledger (section 13/15) - append-only. Outstanding for an
    # order is always total_amount - SUM(dealer_payments.amount).
    # ------------------------------------------------------------------
    op.create_table(
        "dealer_payments",
        _uuid_pk(),
        sa.Column("dealer_order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("payment_date", sa.Date(), nullable=False),
        sa.Column("method", sa.String(30), nullable=True),  # cash | upi | bank_transfer | cheque | other
        sa.Column("reference_number", sa.String(100), nullable=True),
        sa.Column("receipt_image_url", sa.String(500), nullable=True),
        sa.Column("collected_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("collection_status", sa.String(30), nullable=False, server_default="collected"),
        # collection_status covers section 12's non-payment outcomes too
        # (extension_requested, dealer_unavailable, promised, dispute,
        # other) - a "payment" row with amount=0 and one of these
        # statuses records the *attempt*, even when no money changed
        # hands, so collection follow-up history (section 11/15) has a
        # complete trail, not just successful collections.
        sa.Column("remarks", sa.String(1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["dealer_order_id"], ["dealer_orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["collected_by"], ["users.id"], ondelete="RESTRICT"),
        sa.CheckConstraint("amount >= 0", name="ck_dealer_payments_amount_nonneg"),
        sa.CheckConstraint(
            "collection_status IN ('collected', 'extension_requested', 'dealer_unavailable', 'payment_promised', 'dispute', 'other')",
            name="ck_dealer_payments_status",
        ),
    )
    op.create_index("idx_dealer_payments_order", "dealer_payments", ["dealer_order_id"])

    # ------------------------------------------------------------------
    # Deadline extension audit trail (section 14)
    # ------------------------------------------------------------------
    op.create_table(
        "dealer_payment_deadline_history",
        _uuid_pk(),
        sa.Column("dealer_order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("old_deadline", sa.Date(), nullable=True),
        sa.Column("new_deadline", sa.Date(), nullable=False),
        sa.Column("reason", sa.String(500), nullable=True),
        sa.Column("requested_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("approved_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["dealer_order_id"], ["dealer_orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requested_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["approved_by"], ["users.id"], ondelete="SET NULL"),
    )

    # ------------------------------------------------------------------
    # Sales Officer "My Stock" (section 16-23) - extends the existing
    # officer_product_stock table (added for Field Officer Trial
    # tracking) with a directly-editable current_quantity, rather than
    # creating a parallel stock table for the same underlying concept.
    # ------------------------------------------------------------------
    op.add_column("officer_product_stock", sa.Column("current_quantity", sa.Numeric(10, 2), nullable=False, server_default="0"))
    op.add_column("officer_product_stock", sa.Column("unit", sa.String(20), nullable=True))

    op.create_table(
        "officer_stock_adjustments",
        _uuid_pk(),
        sa.Column("officer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("previous_quantity", sa.Numeric(10, 2), nullable=False),
        sa.Column("new_quantity", sa.Numeric(10, 2), nullable=False),
        sa.Column("reason", sa.String(50), nullable=False),
        # sold | damaged | transferred | returned | count_correction | other
        sa.Column("remarks", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["officer_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.CheckConstraint("previous_quantity >= 0 AND new_quantity >= 0", name="ck_officer_stock_adj_nonneg"),
        sa.CheckConstraint(
            "reason IN ('sold', 'damaged', 'transferred', 'returned', 'count_correction', 'other')",
            name="ck_officer_stock_adj_reason",
        ),
    )
    op.create_index("idx_officer_stock_adjustments_officer", "officer_stock_adjustments", ["officer_id"])

    # ------------------------------------------------------------------
    # Marketing materials (section 24-28)
    # ------------------------------------------------------------------
    op.create_table(
        "marketing_categories",
        _uuid_pk(),
        sa.Column("name", sa.String(50), nullable=False, unique=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.execute(
        """
        INSERT INTO marketing_categories (id, name) VALUES
        (gen_random_uuid(), 'Competitor Advertisement'), (gen_random_uuid(), 'Dealer Promotion'),
        (gen_random_uuid(), 'Product Display'), (gen_random_uuid(), 'Agricultural Campaign'),
        (gen_random_uuid(), 'Outdoor Poster'), (gen_random_uuid(), 'Retail Branding'),
        (gen_random_uuid(), 'Social/Print Marketing'), (gen_random_uuid(), 'Other')
        """
    )

    op.create_table(
        "marketing_materials",
        _uuid_pk(),
        sa.Column("officer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("image_url", sa.String(500), nullable=False),
        sa.Column("title", sa.String(200), nullable=True),
        sa.Column("description", sa.String(1000), nullable=True),
        sa.Column("category_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("district", sa.String(100), nullable=True),
        sa.Column("latitude", sa.Numeric(9, 6), nullable=True),
        sa.Column("longitude", sa.Numeric(9, 6), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["officer_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["category_id"], ["marketing_categories.id"], ondelete="SET NULL"),
    )
    op.create_index("idx_marketing_materials_officer", "marketing_materials", ["officer_id"])
    op.create_index("idx_marketing_materials_district", "marketing_materials", ["district"])

    # ------------------------------------------------------------------
    # Admin-configurable reminder schedule (section 9)
    # ------------------------------------------------------------------
    op.create_table(
        "payment_reminder_schedule",
        _uuid_pk(),
        sa.Column("days_before_deadline", sa.SmallInteger(), nullable=False, unique=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.execute(
        """
        INSERT INTO payment_reminder_schedule (id, days_before_deadline) VALUES
        (gen_random_uuid(), 7), (gen_random_uuid(), 3), (gen_random_uuid(), 1), (gen_random_uuid(), 0)
        """
    )


def downgrade() -> None:
    op.drop_table("payment_reminder_schedule")
    op.drop_index("idx_marketing_materials_district", table_name="marketing_materials")
    op.drop_index("idx_marketing_materials_officer", table_name="marketing_materials")
    op.drop_table("marketing_materials")
    op.drop_table("marketing_categories")
    op.drop_index("idx_officer_stock_adjustments_officer", table_name="officer_stock_adjustments")
    op.drop_table("officer_stock_adjustments")
    op.drop_column("officer_product_stock", "unit")
    op.drop_column("officer_product_stock", "current_quantity")
    op.drop_table("dealer_payment_deadline_history")
    op.drop_index("idx_dealer_payments_order", table_name="dealer_payments")
    op.drop_table("dealer_payments")
    op.drop_column("dealer_orders", "payment_terms")
    op.drop_column("dealer_orders", "payment_deadline")
    op.drop_index("idx_dealers_gst_number", table_name="dealers")
    op.drop_index("idx_dealers_assigned_officer", table_name="dealers")
    op.drop_constraint("fk_dealers_assigned_sales_officer", "dealers", type_="foreignkey")
    op.drop_column("dealers", "assigned_sales_officer_id")
    op.drop_column("dealers", "remarks")
    op.drop_column("dealers", "dealer_type")
    op.drop_column("dealers", "gst_number")
    op.drop_column("dealers", "pin_code")
    op.drop_column("dealers", "state")
    op.drop_column("dealers", "alternate_contact")
