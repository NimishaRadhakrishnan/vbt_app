"""add is_active to products (enables Admin product CRUD soft-delete)

Revision ID: 202608260003
Revises: 202608260002
Create Date: 2026-08-26 01:00:00

`ProductModel` had no active/deleted flag at all, so there was no way to
soft-delete a product without either hard-deleting a row that
dealer_stocks/order_items/stock_movements/officer_product_stock all
FK-reference, or leaving discontinued products permanently visible in
every dealer/officer stock picker. Every other admin-mutable table in
this codebase (dealers.is_deleted, pests/diseases/chemicals/
farm_operations/organic_solutions/marketing_categories.is_active) already
has one; products was the one master-data-shaped table that didn't.

Named `is_active` (not `is_deleted`, matching dealers) to be consistent
with the *other* admin-CRUD-but-lookup-shaped tables in this schema -
products behaves like a catalog entry an admin toggles on/off, not like a
dealer whose lifecycle has pending_approval/rejected states.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "202608260003"
down_revision: str | None = "202608260002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
    )


def downgrade() -> None:
    op.drop_column("products", "is_active")
