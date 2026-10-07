"""Add the Vishakan product range (price not set yet)

Adds every product and pack size from the company list to the one products
table that every screen reads (visits, trials, stock, orders, day closure).
Prices are not on the list, so they start at 0: everything works except
ordering, which refuses a product with no price until an admin sets one on
the Products page. Safe to run twice: existing SKUs or names are skipped.

Revision ID: 202610070002
Revises: 202610070001
Create Date: 2026-10-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "202610070002"
down_revision: Union[str, None] = "202610070001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PRODUCTS = [
    ('V-NITRO (Carrier 1 Kg)', 'Bio-Fertilizers', 'V-NITRO-CARRIER-1-KG'),
    ('V-NITRO (Liquid 5 Lit)', 'Bio-Fertilizers', 'V-NITRO-LIQUID-5-LIT'),
    ('V-NITRO (Liquid 1 Lit)', 'Bio-Fertilizers', 'V-NITRO-LIQUID-1-LIT'),
    ('V-NITRO (Liquid 500ml)', 'Bio-Fertilizers', 'V-NITRO-LIQUID-500ML'),
    ('V-AZOTO (Carrier 1 Kg)', 'Bio-Fertilizers', 'V-AZOTO-CARRIER-1-KG'),
    ('V-AZOTO (Liquid 5 Lit)', 'Bio-Fertilizers', 'V-AZOTO-LIQUID-5-LIT'),
    ('V-AZOTO (Liquid 1 Lit)', 'Bio-Fertilizers', 'V-AZOTO-LIQUID-1-LIT'),
    ('V-AZOTO (Liquid 500ml)', 'Bio-Fertilizers', 'V-AZOTO-LIQUID-500ML'),
    ('V-RIZHO (Carrier 1 Kg)', 'Bio-Fertilizers', 'V-RIZHO-CARRIER-1-KG'),
    ('V-RIZHO (Liquid 5 Lit)', 'Bio-Fertilizers', 'V-RIZHO-LIQUID-5-LIT'),
    ('V-RIZHO (Liquid 1 Lit)', 'Bio-Fertilizers', 'V-RIZHO-LIQUID-1-LIT'),
    ('V-RIZHO (Liquid 500ml)', 'Bio-Fertilizers', 'V-RIZHO-LIQUID-500ML'),
    ('V-PHOS (Carrier 1 Kg)', 'Bio-Fertilizers', 'V-PHOS-CARRIER-1-KG'),
    ('V-PHOS (Liquid 5 Lit)', 'Bio-Fertilizers', 'V-PHOS-LIQUID-5-LIT'),
    ('V-PHOS (Liquid 1 Lit)', 'Bio-Fertilizers', 'V-PHOS-LIQUID-1-LIT'),
    ('V-PHOS (Liquid 500ml)', 'Bio-Fertilizers', 'V-PHOS-LIQUID-500ML'),
    ('V-SOL-K (Carrier 1 Kg)', 'Bio-Fertilizers', 'V-SOL-K-CARRIER-1-KG'),
    ('V-SOL-K (Liquid 5 Lit)', 'Bio-Fertilizers', 'V-SOL-K-LIQUID-5-LIT'),
    ('V-SOL-K (Liquid 1 Lit)', 'Bio-Fertilizers', 'V-SOL-K-LIQUID-1-LIT'),
    ('V-SOL-K (Liquid 500ml)', 'Bio-Fertilizers', 'V-SOL-K-LIQUID-500ML'),
    ('VISHAKAN BIO-NPK (Liquid 5 Lit)', 'Bio-Fertilizers', 'VISHAKAN-BIO-NPK-LIQUID-5-LIT'),
    ('VISHAKAN BIO-NPK (Liquid 1 Lit)', 'Bio-Fertilizers', 'VISHAKAN-BIO-NPK-LIQUID-1-LIT'),
    ('VISHAKAN BIO-NPK (Liquid 500ml)', 'Bio-Fertilizers', 'VISHAKAN-BIO-NPK-LIQUID-500ML'),
    ('V-ZINC (Carrier 1 Kg)', 'Bio-Fertilizers', 'V-ZINC-CARRIER-1-KG'),
    ('V-ZINC (Liquid 5 Lit)', 'Bio-Fertilizers', 'V-ZINC-LIQUID-5-LIT'),
    ('V-ZINC (Liquid 1 Lit)', 'Bio-Fertilizers', 'V-ZINC-LIQUID-1-LIT'),
    ('V-ZINC (Liquid 500ml)', 'Bio-Fertilizers', 'V-ZINC-LIQUID-500ML'),
    ('V-RICH (Carrier 1 Kg)', 'Bio-Fertilizers', 'V-RICH-CARRIER-1-KG'),
    ('V-RICH (Carrier 5 Kg)', 'Bio-Fertilizers', 'V-RICH-CARRIER-5-KG'),
    ('V-RICH (Liquid 5 Lit)', 'Bio-Fertilizers', 'V-RICH-LIQUID-5-LIT'),
    ('V-RICH (Liquid 1 Lit)', 'Bio-Fertilizers', 'V-RICH-LIQUID-1-LIT'),
    ('V-RICH (Liquid 500ml)', 'Bio-Fertilizers', 'V-RICH-LIQUID-500ML'),
    ('V-BMC (950ml)', 'Bio-Fertilizers', 'V-BMC-950ML'),
    ('V-BIOPOTASH (Liquid 5 Ltr)', 'Bio-Fertilizers', 'V-BIOPOTASH-LIQUID-5-LTR'),
    ('V-BIOPOTASH (Liquid 1 Lit)', 'Bio-Fertilizers', 'V-BIOPOTASH-LIQUID-1-LIT'),
    ('V-BIOPOTASH (Liquid 500ml)', 'Bio-Fertilizers', 'V-BIOPOTASH-LIQUID-500ML'),
    ('V-BIOPOTASH (Liquid 250ml)', 'Bio-Fertilizers', 'V-BIOPOTASH-LIQUID-250ML'),
    ('V-BIOPHOS (Liquid 5 Ltr)', 'Bio-Fertilizers', 'V-BIOPHOS-LIQUID-5-LTR'),
    ('V-BIOPHOS (Liquid 1 Lit)', 'Bio-Fertilizers', 'V-BIOPHOS-LIQUID-1-LIT'),
    ('V-BIOPHOS (Liquid 500ml)', 'Bio-Fertilizers', 'V-BIOPHOS-LIQUID-500ML'),
    ('V-BIOPHOS (Liquid 250ml)', 'Bio-Fertilizers', 'V-BIOPHOS-LIQUID-250ML'),
    ('V-KITIN (5 Lit)', 'Bio-Fertilizers', 'V-KITIN-5-LIT'),
    ('V-KITIN (1 Lit)', 'Bio-Fertilizers', 'V-KITIN-1-LIT'),
    ('V-KITIN (500 ML)', 'Bio-Fertilizers', 'V-KITIN-500-ML'),
    ('V-KITIN (250 ML)', 'Bio-Fertilizers', 'V-KITIN-250-ML'),
    ('V-Methylobacter (10 Lit)', 'Bio-Fertilizers', 'V-METHYLOBACTER-10-LIT'),
    ('V-Methylobacter (5 Lit)', 'Bio-Fertilizers', 'V-METHYLOBACTER-5-LIT'),
    ('V-Methylobacter (1 Lit)', 'Bio-Fertilizers', 'V-METHYLOBACTER-1-LIT'),
    ('VIRIDINE (Carrier 1 Kg)', 'Bio-Pesticides', 'VIRIDINE-CARRIER-1-KG'),
    ('VIRIDINE (Liquid 5 Lit)', 'Bio-Pesticides', 'VIRIDINE-LIQUID-5-LIT'),
    ('VIRIDINE (Liquid 1 Lit)', 'Bio-Pesticides', 'VIRIDINE-LIQUID-1-LIT'),
    ('VIRIDINE (Liquid 500ml)', 'Bio-Pesticides', 'VIRIDINE-LIQUID-500ML'),
    ('V-CURE (Carrier 1 Kg)', 'Bio-Pesticides', 'V-CURE-CARRIER-1-KG'),
    ('V-CURE (Liquid 5 Lit)', 'Bio-Pesticides', 'V-CURE-LIQUID-5-LIT'),
    ('V-CURE (Liquid 1 Lit)', 'Bio-Pesticides', 'V-CURE-LIQUID-1-LIT'),
    ('V-CURE (Liquid 500ml)', 'Bio-Pesticides', 'V-CURE-LIQUID-500ML'),
    ('V-BACILI (Carrier 1 Kg)', 'Bio-Pesticides', 'V-BACILI-CARRIER-1-KG'),
    ('V-BACILI (Liquid 5 Lit)', 'Bio-Pesticides', 'V-BACILI-LIQUID-5-LIT'),
    ('V-BACILI (Liquid 1 Lit)', 'Bio-Pesticides', 'V-BACILI-LIQUID-1-LIT'),
    ('V-BACILI (Liquid 500ml)', 'Bio-Pesticides', 'V-BACILI-LIQUID-500ML'),
    ('V-CIDE (Carrier 1 Kg)', 'Bio-Pesticides', 'V-CIDE-CARRIER-1-KG'),
    ('V-CIDE (Liquid 5 Lit)', 'Bio-Pesticides', 'V-CIDE-LIQUID-5-LIT'),
    ('V-CIDE (Liquid 1 Lit)', 'Bio-Pesticides', 'V-CIDE-LIQUID-1-LIT'),
    ('V-CIDE (Liquid 500ml)', 'Bio-Pesticides', 'V-CIDE-LIQUID-500ML'),
    ('V-KILL (Carrier 1 Kg)', 'Bio-Pesticides', 'V-KILL-CARRIER-1-KG'),
    ('V-KILL (Liquid 5 Lit)', 'Bio-Pesticides', 'V-KILL-LIQUID-5-LIT'),
    ('V-KILL (Liquid 1 Lit)', 'Bio-Pesticides', 'V-KILL-LIQUID-1-LIT'),
    ('V-KILL (Liquid 500ml)', 'Bio-Pesticides', 'V-KILL-LIQUID-500ML'),
    ('V-FIGHT (Carrier 1 Kg)', 'Bio-Pesticides', 'V-FIGHT-CARRIER-1-KG'),
    ('V-FIGHT (Liquid 5 Lit)', 'Bio-Pesticides', 'V-FIGHT-LIQUID-5-LIT'),
    ('V-FIGHT (Liquid 1 Lit)', 'Bio-Pesticides', 'V-FIGHT-LIQUID-1-LIT'),
    ('V-FIGHT (Liquid 500ml)', 'Bio-Pesticides', 'V-FIGHT-LIQUID-500ML'),
    ('V-NEMATO (Carrier 1 Kg)', 'Bio-Pesticides', 'V-NEMATO-CARRIER-1-KG'),
    ('V-NEMATO (Liquid 5 Lit)', 'Bio-Pesticides', 'V-NEMATO-LIQUID-5-LIT'),
    ('V-NEMATO (Liquid 1 Lit)', 'Bio-Pesticides', 'V-NEMATO-LIQUID-1-LIT'),
    ('V-NEMATO (Liquid 500ml)', 'Bio-Pesticides', 'V-NEMATO-LIQUID-500ML'),
    ('V-PRIME (Carrier 1 Kg)', 'Bio-Pesticides', 'V-PRIME-CARRIER-1-KG'),
    ('V-HUME (Liquid 10 Lit)', 'Plant Growth Promoters', 'V-HUME-LIQUID-10-LIT'),
    ('V-HUME (Liquid 5 Lit)', 'Plant Growth Promoters', 'V-HUME-LIQUID-5-LIT'),
    ('V-HUME (Liquid 1 Lit)', 'Plant Growth Promoters', 'V-HUME-LIQUID-1-LIT'),
    ('V-HUME (Liquid 500ml)', 'Plant Growth Promoters', 'V-HUME-LIQUID-500ML'),
    ('V-HUME (Liquid 250ml)', 'Plant Growth Promoters', 'V-HUME-LIQUID-250ML'),
    ('V-HUME (Liquid 100ml)', 'Plant Growth Promoters', 'V-HUME-LIQUID-100ML'),
    ('VMINO (Liquid 10 Ltr)', 'Plant Growth Promoters', 'VMINO-LIQUID-10-LTR'),
    ('VMINO (Liquid 5 Ltr)', 'Plant Growth Promoters', 'VMINO-LIQUID-5-LTR'),
    ('VMINO (Liquid 1 Lit)', 'Plant Growth Promoters', 'VMINO-LIQUID-1-LIT'),
    ('VMINO (Liquid 500ml)', 'Plant Growth Promoters', 'VMINO-LIQUID-500ML'),
    ('VMINO (Liquid 250ml)', 'Plant Growth Promoters', 'VMINO-LIQUID-250ML'),
    ('VMINO (Liquid 100ml)', 'Plant Growth Promoters', 'VMINO-LIQUID-100ML'),
    ('V-ZYME (Liquid 10 Ltr)', 'Plant Growth Promoters', 'V-ZYME-LIQUID-10-LTR'),
    ('V-ZYME (Liquid 5 Ltr)', 'Plant Growth Promoters', 'V-ZYME-LIQUID-5-LTR'),
    ('V-ZYME (Liquid 1 Lit)', 'Plant Growth Promoters', 'V-ZYME-LIQUID-1-LIT'),
    ('V-ZYME (Liquid 500 ml)', 'Plant Growth Promoters', 'V-ZYME-LIQUID-500-ML'),
    ('V-ZYME (Liquid 250ml)', 'Plant Growth Promoters', 'V-ZYME-LIQUID-250ML'),
    ('V-ZYME (Liquid 100ml)', 'Plant Growth Promoters', 'V-ZYME-LIQUID-100ML'),
    ('V-ZYME (1 Kg)', 'Plant Growth Promoters', 'V-ZYME-1-KG'),
    ('V-ZYME (5 Kg)', 'Plant Growth Promoters', 'V-ZYME-5-KG'),
    ('V-ZYME (10 Kg)', 'Plant Growth Promoters', 'V-ZYME-10-KG'),
    ('V-ZYME GR (1 Kg)', 'Plant Growth Promoters', 'V-ZYME-GR-1-KG'),
    ('V-ZYME GR (5 Kg)', 'Plant Growth Promoters', 'V-ZYME-GR-5-KG'),
    ('V-ZYME GR (10 Kg)', 'Plant Growth Promoters', 'V-ZYME-GR-10-KG'),
    ('V-Hume Gr (1 Kg)', 'Plant Growth Promoters', 'V-HUME-GR-1-KG'),
    ('V-Hume Gr (5 Kg)', 'Plant Growth Promoters', 'V-HUME-GR-5-KG'),
    ('V-Hume Gr (10 Kg)', 'Plant Growth Promoters', 'V-HUME-GR-10-KG'),
    ('V-Combine Gr (1 Kg)', 'Plant Growth Promoters', 'V-COMBINE-GR-1-KG'),
    ('V-Combine Gr (5 Kg)', 'Plant Growth Promoters', 'V-COMBINE-GR-5-KG'),
    ('V-Combine Gr (10 Kg)', 'Plant Growth Promoters', 'V-COMBINE-GR-10-KG'),
    ('V-COMBINE (10 ltr)', 'Plant Growth Promoters', 'V-COMBINE-10-LTR'),
    ('V-COMBINE (5 Ltr)', 'Plant Growth Promoters', 'V-COMBINE-5-LTR'),
    ('V-COMBINE (1 Lit)', 'Plant Growth Promoters', 'V-COMBINE-1-LIT'),
    ('V-COMBINE (500ml)', 'Plant Growth Promoters', 'V-COMBINE-500ML'),
    ('V-COMBINE (250ml)', 'Plant Growth Promoters', 'V-COMBINE-250ML'),
    ('YIELDER PLUS (Liquid 25 Ltr)', 'Plant Growth Promoters', 'YIELDER-PLUS-LIQUID-25-LTR'),
    ('YIELDER PLUS (Liquid 10 Ltr)', 'Plant Growth Promoters', 'YIELDER-PLUS-LIQUID-10-LTR'),
    ('YIELDER PLUS (Liquid 5 Ltr)', 'Plant Growth Promoters', 'YIELDER-PLUS-LIQUID-5-LTR'),
    ('YIELDER PLUS (Liquid 1 Lit)', 'Plant Growth Promoters', 'YIELDER-PLUS-LIQUID-1-LIT'),
    ('YIELDER PLUS (Liquid 500ml)', 'Plant Growth Promoters', 'YIELDER-PLUS-LIQUID-500ML'),
    ('YIELDER PLUS (Liquid 250ml)', 'Plant Growth Promoters', 'YIELDER-PLUS-LIQUID-250ML'),
    ('YIELDER PLUS (Liquid 100ml)', 'Plant Growth Promoters', 'YIELDER-PLUS-LIQUID-100ML'),
    ('V-FULVIC (Liquid 5 Ltr)', 'Plant Growth Promoters', 'V-FULVIC-LIQUID-5-LTR'),
    ('V-FULVIC (Liquid 1 Lit)', 'Plant Growth Promoters', 'V-FULVIC-LIQUID-1-LIT'),
    ('V-FULVIC (Liquid 500ml)', 'Plant Growth Promoters', 'V-FULVIC-LIQUID-500ML'),
    ('V-FULVIC (Liquid 250ml)', 'Plant Growth Promoters', 'V-FULVIC-LIQUID-250ML'),
    ('V-Hume 49 (1 Kg)', 'Plant Growth Promoters', 'V-HUME-49-1-KG'),
    ('V-Hume 49 (500 g)', 'Plant Growth Promoters', 'V-HUME-49-500-G'),
    ('SOIL BIOBOOSTER (1 Kg)', 'Bio-Fertilizers', 'SOIL-BIOBOOSTER-1-KG'),
    ('ROT ARREST (1 Kg)', 'Bio-Pesticides', 'ROT-ARREST-1-KG'),
    ('BIODEFENSE (1 Kg)', 'Bio-Pesticides', 'BIODEFENSE-1-KG'),
    ('PAECIODINE (1 Kg)', 'Bio-Pesticides', 'PAECIODINE-1-KG'),
    ('V-ZOOT (Liquid 10 Ltr)', 'Plant Growth Promoters', 'V-ZOOT-LIQUID-10-LTR'),
    ('V-ZOOT (Liquid 5 Ltr)', 'Plant Growth Promoters', 'V-ZOOT-LIQUID-5-LTR'),
    ('V-ZOOT (Liquid 1 Lit)', 'Plant Growth Promoters', 'V-ZOOT-LIQUID-1-LIT'),
    ('V-ZOOT (Liquid 500ml)', 'Plant Growth Promoters', 'V-ZOOT-LIQUID-500ML'),
    ('V-ZOOT (Liquid 250ml)', 'Plant Growth Promoters', 'V-ZOOT-LIQUID-250ML'),
    ('V-ZOOT (Liquid 100ML)', 'Plant Growth Promoters', 'V-ZOOT-LIQUID-100ML'),
    ('V-NIMBIDINE (Liquid 1 Ltr)', 'Bio-Pesticides', 'V-NIMBIDINE-LIQUID-1-LTR'),
    ('V-NIMBIDINE (Liquid 500ml)', 'Bio-Pesticides', 'V-NIMBIDINE-LIQUID-500ML'),
    ('V-NIMBIDINE (Liquid 250ml)', 'Bio-Pesticides', 'V-NIMBIDINE-LIQUID-250ML'),
    ('V-NIMBIDINE (Liquid 100ml)', 'Bio-Pesticides', 'V-NIMBIDINE-LIQUID-100ML'),
    ('V-CLEAN (900Gms)', 'Plant Growth Promoters', 'V-CLEAN-900GMS'),
    ('V-COMPOST (1 Kg)', 'Plant Growth Promoters', 'V-COMPOST-1-KG'),
    ('V-SILICA (1 Lit)', 'Plant Growth Promoters', 'V-SILICA-1-LIT'),
    ('V-SILICA (500ml)', 'Plant Growth Promoters', 'V-SILICA-500ML'),
    ('V-SILICA (5 Lit)', 'Plant Growth Promoters', 'V-SILICA-5-LIT'),
    ('V-SILICA (10 Lit)', 'Plant Growth Promoters', 'V-SILICA-10-LIT'),
    ('V-NUTRINOL (Liquid 10 Ltr)', 'Plant Growth Promoters', 'V-NUTRINOL-LIQUID-10-LTR'),
    ('V-NUTRINOL (Liquid 5 Ltr)', 'Plant Growth Promoters', 'V-NUTRINOL-LIQUID-5-LTR'),
    ('V-NUTRINOL (1 Lit)', 'Plant Growth Promoters', 'V-NUTRINOL-1-LIT'),
    ('V-NUTRINOL (Liquid 500ml)', 'Plant Growth Promoters', 'V-NUTRINOL-LIQUID-500ML'),
    ('V-NUTRINOL (Liquid 250ml)', 'Plant Growth Promoters', 'V-NUTRINOL-LIQUID-250ML'),
    ('V-NUTRINOL (1 Kg)', 'Plant Growth Promoters', 'V-NUTRINOL-1-KG'),
    ('V-NUTRINOL (500 gms)', 'Plant Growth Promoters', 'V-NUTRINOL-500-GMS'),
    ('V-NUTRINOL (250 gms)', 'Plant Growth Promoters', 'V-NUTRINOL-250-GMS'),
    ('COCO NUTRI (1 kg)', 'Plant Growth Promoters', 'COCO-NUTRI-1-KG'),
    ('COCO NUTRI (10kg)', 'Plant Growth Promoters', 'COCO-NUTRI-10KG'),
    ('V-ATTACK (Liquid 500ml)', 'Bio-Pesticides', 'V-ATTACK-LIQUID-500ML'),
    ('V-ATTACK (Liquid 250ml)', 'Bio-Pesticides', 'V-ATTACK-LIQUID-250ML'),
    ('V-ATTACK (Liquid 100ml)', 'Bio-Pesticides', 'V-ATTACK-LIQUID-100ML'),
    ('V-ATTACK (Liquid 50ml)', 'Bio-Pesticides', 'V-ATTACK-LIQUID-50ML'),
    ('V-MIRACLE (Liquid 500ml)', 'Bio-Pesticides', 'V-MIRACLE-LIQUID-500ML'),
    ('V-MIRACLE (Liquid 250ml)', 'Bio-Pesticides', 'V-MIRACLE-LIQUID-250ML'),
    ('V-MIRACLE (Liquid 100ml)', 'Bio-Pesticides', 'V-MIRACLE-LIQUID-100ML'),
    ('V-MIRACLE (Liquid 50ml)', 'Bio-Pesticides', 'V-MIRACLE-LIQUID-50ML'),
    ('WARRIOR (Liquid 1 Lit)', 'Bio-Pesticides', 'WARRIOR-LIQUID-1-LIT'),
    ('VIRUS FENDER (Liquid 1 Lit)', 'Bio-Pesticides', 'VIRUS-FENDER-LIQUID-1-LIT'),
    ('VIRUS FENDER (Liquid 500ml)', 'Bio-Pesticides', 'VIRUS-FENDER-LIQUID-500ML'),
    ('VIRUS FENDER (Liquid 250ml)', 'Bio-Pesticides', 'VIRUS-FENDER-LIQUID-250ML'),
    ('VIRUS FENDER (Liquid 100ml)', 'Bio-Pesticides', 'VIRUS-FENDER-LIQUID-100ML'),
    ('WET SPREAD (Liquid 1 Lit)', 'Plant Growth Promoters', 'WET-SPREAD-LIQUID-1-LIT'),
    ('WET SPREAD (Liquid 500ml)', 'Plant Growth Promoters', 'WET-SPREAD-LIQUID-500ML'),
    ('WET SPREAD (Liquid 250ml)', 'Plant Growth Promoters', 'WET-SPREAD-LIQUID-250ML'),
    ('WET SPREAD (Liquid 100ml)', 'Plant Growth Promoters', 'WET-SPREAD-LIQUID-100ML'),
    ('WET SPREAD (Liquid 50ml)', 'Plant Growth Promoters', 'WET-SPREAD-LIQUID-50ML'),
    ('V-CHILL (Liquid 1 Lit)', 'Plant Growth Promoters', 'V-CHILL-LIQUID-1-LIT'),
    ('V-CHILL (Liquid 500ml)', 'Plant Growth Promoters', 'V-CHILL-LIQUID-500ML'),
    ('V-CHILL (Liquid 250ml)', 'Plant Growth Promoters', 'V-CHILL-LIQUID-250ML'),
    ('V-KRISHONATE (Liquid 500ml)', 'Bio-Pesticides', 'V-KRISHONATE-LIQUID-500ML'),
    ('V-KRISHONATE (Liquid 1 Ltr)', 'Bio-Pesticides', 'V-KRISHONATE-LIQUID-1-LTR'),
]


def upgrade() -> None:
    conn = op.get_bind()
    for name, category, sku in PRODUCTS:
        conn.execute(
            sa.text(
                "INSERT INTO products (name, category, sku_code, price, is_active) "
                "SELECT :name, :category, :sku, 0, true "
                "WHERE NOT EXISTS (SELECT 1 FROM products WHERE sku_code = :sku OR lower(name) = lower(:name))"
            ),
            {"name": name, "category": category, "sku": sku},
        )


def downgrade() -> None:
    # Only removes products nothing refers to; used ones are deactivated.
    conn = op.get_bind()
    for _name, _category, sku in PRODUCTS:
        try:
            with conn.begin_nested():
                conn.execute(sa.text("DELETE FROM products WHERE sku_code = :sku AND price = 0"), {"sku": sku})
        except Exception:
            conn.execute(sa.text("UPDATE products SET is_active = false WHERE sku_code = :sku"), {"sku": sku})
