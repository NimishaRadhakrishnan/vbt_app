"""Stock left in the dealer's shop, one row per product pack

Each dealer day closure can carry the stock still lying in the dealer's
shop: one row per product pack (the products table already holds every
pack size as its own product). The product name and category are copied
onto the row, so an admin retiring or renaming a product later never
changes or breaks a past report.

Revision ID: 202610130002
Revises: 202610130001
Create Date: 2026-10-13
"""
from typing import Sequence, Union

from alembic import op

revision: str = "202610130002"
down_revision: Union[str, None] = "202610130001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS sales_closure_stock_lines (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            closure_id UUID NOT NULL REFERENCES day_closures(id) ON DELETE CASCADE,
            product_id UUID REFERENCES products(id) ON DELETE SET NULL,
            category VARCHAR(100),
            product_name VARCHAR(200) NOT NULL,
            quantity_left INTEGER NOT NULL CHECK (quantity_left >= 0),
            remarks VARCHAR(300),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_sales_stock_lines_closure "
        "ON sales_closure_stock_lines (closure_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS sales_closure_stock_lines")
