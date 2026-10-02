"""The two fields the management dashboard needs and the database did not have

A senior-management dashboard was asked for: sales, profit, officer
performance, product intelligence, seasonality. Auditing what the database
could actually answer turned up two gaps. Neither is filled with a guess here;
both are added as nullable columns so the dashboard can say "not recorded"
until somebody enters the real figure.

1. PROFIT WAS NOT COMPUTABLE
   ------------------------
   `products` had `price` and no cost of any kind. Searching the whole
   codebase for cost / margin / mrp / purchase_price found nothing but PDF
   page margins. Without a cost there is no profit, and inventing one would
   put a fabricated number in front of the owner - the single worst outcome
   for a screen whose whole purpose is to be trusted at a glance.

   `cost_price` is nullable on purpose. Contribution is reported only for
   products that have one, and the dashboard states plainly how much of
   revenue it could not assess rather than quietly treating an unknown cost
   as zero - which would report 100% margin on every unpriced product.

2. FIELD-SALE REVENUE WAS NOT COMPUTABLE
   -------------------------------------
   When an officer records a sale on a visit, `visit_sale_items` stored
   product and quantity and `unit`, and no price. `visit_sales.order_value`
   is one total for the whole visit, so it cannot be split across the
   products in it. The consequence: "who is selling more of which product,
   in rupees" was answerable for dealer orders only, and the field force -
   the thing this whole application exists to manage - contributed quantity
   but no money.

   `unit_price` and `line_total` are added, both nullable because every row
   written before this migration has no price and never will. New rows get
   the price from the resolver in app/domain/services/pricing.py, so a field
   sale is valued the same way a dealer order is: by quantity band, and by
   dealer where one applies.

   `line_total` is stored rather than computed on read because the price of
   a sale is a fact about the day it happened. Recomputing it later from
   today's price list would silently restate last quarter's revenue every
   time somebody edits a price band.

WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--------------------------------------------
It back-fills nothing. Existing visit_sale_items rows keep a NULL price, and
the dashboard counts them as quantity only, saying so. Filling them from
today's list price would be inventing history.

Sales-value targets needed no schema change: `officer_monthly_targets` is
(officer_id, period, metric, target_value) with a free-text metric, so a
target is a row with metric='sales_value'. Adding a column for it would have
been a second way to say the same thing.

Revision ID: 202609300002
Revises: 202609300001
Create Date: 2026-09-30
"""
from typing import Sequence, Union

from alembic import op

revision: str = "202609300002"
down_revision: Union[str, None] = "202609300001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE products
            ADD COLUMN IF NOT EXISTS cost_price numeric(12, 2)
        """
    )
    op.execute(
        """
        ALTER TABLE products
            ADD CONSTRAINT ck_product_cost_positive
            CHECK (cost_price IS NULL OR cost_price > 0)
        """
    )

    op.execute(
        """
        ALTER TABLE visit_sale_items
            ADD COLUMN IF NOT EXISTS unit_price numeric(12, 2),
            ADD COLUMN IF NOT EXISTS line_total numeric(12, 2)
        """
    )
    op.execute(
        """
        ALTER TABLE visit_sale_items
            ADD CONSTRAINT ck_visit_sale_item_price_positive
            CHECK (unit_price IS NULL OR unit_price > 0)
        """
    )

    # The dashboard's heaviest queries group sales by month and by product.
    # Without these every load sequentially scans the order tables, which is
    # fine at three orders and not fine at three years of them.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_dealer_orders_order_date "
        "ON dealer_orders (order_date)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_dealer_orders_created_by_date "
        "ON dealer_orders (created_by, order_date)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_order_items_product "
        "ON order_items (product_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_visit_sale_items_product "
        "ON visit_sale_items (product_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_visit_sale_items_product")
    op.execute("DROP INDEX IF EXISTS ix_order_items_product")
    op.execute("DROP INDEX IF EXISTS ix_dealer_orders_created_by_date")
    op.execute("DROP INDEX IF EXISTS ix_dealer_orders_order_date")
    op.execute(
        "ALTER TABLE visit_sale_items "
        "DROP CONSTRAINT IF EXISTS ck_visit_sale_item_price_positive"
    )
    op.execute(
        "ALTER TABLE visit_sale_items "
        "DROP COLUMN IF EXISTS line_total, DROP COLUMN IF EXISTS unit_price"
    )
    op.execute("ALTER TABLE products DROP CONSTRAINT IF EXISTS ck_product_cost_positive")
    op.execute("ALTER TABLE products DROP COLUMN IF EXISTS cost_price")
