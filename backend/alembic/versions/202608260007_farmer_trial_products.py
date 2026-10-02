"""farmers: trial-conducted tracking against officer product stock

Revision ID: 202608260007
Revises: 202608260006
Create Date: 2026-08-26 05:00:00

Field Officer's "Register New Farmer" form gets a Trial Conducted
yes/no + product/quantity list. Stock is drawn from the SAME
officer_product_stock allocation the Daily Visit Tracker's trial system
already uses (trial_router.py's GET /trial/my-stock formula: opening +
received - given), not a separate pool - an officer who's already given
out product via a Daily Visit Tracker trial has that much less available
here too, and vice versa. "Given" for this purpose is computed live as
SUM(visit_trial_products) + SUM(farmer_trial_products) rather than
decrementing a stored running-balance column, matching the existing
deliberate design choice documented in trial_router.py (a stored balance
can drift from the real history; a live sum from source rows can't).

farmer_trial_products is a new satellite table (farmer_id, product_id,
quantity), not a JSON blob on farmers, for the same reason every other
one-to-many detail in this schema is its own table - queryable, joinable,
consistent with visit_trial_products' own shape.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202608260007"
down_revision: str | None = "202608260006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("farmers", sa.Column("trial_conducted", sa.Boolean(), nullable=False, server_default="false"))

    op.create_table(
        "farmer_trial_products",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("farmer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("farmers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("quantity", sa.Numeric(10, 2), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_farmer_trial_products_farmer_id", "farmer_trial_products", ["farmer_id"])
    op.create_index("ix_farmer_trial_products_product_id", "farmer_trial_products", ["product_id"])


def downgrade() -> None:
    op.drop_index("ix_farmer_trial_products_product_id", table_name="farmer_trial_products")
    op.drop_index("ix_farmer_trial_products_farmer_id", table_name="farmer_trial_products")
    op.drop_table("farmer_trial_products")
    op.drop_column("farmers", "trial_conducted")
