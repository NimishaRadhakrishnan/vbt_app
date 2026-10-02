"""product_price_tiers: price by quantity band, optionally per dealer

A product had exactly one price. The business does not work that way: the
rate depends on how much is being bought, and a particular dealer may be on
terms of their own.

  Bio-NPK Liquid   1-10 units    Rs 450     (everyone)
                   11-50 units   Rs 420     (everyone)
                   51+ units     Rs 400     (everyone)
                   1-10 units    Rs 430     (Kannan Agro Center only)

Resolution is most-specific-wins: a tier for this dealer beats a general
tier, a general tier beats products.price. products.price stays as the list
price and the fallback, so nothing breaks for a product with no tiers.

THE CONSTRAINT THAT MATTERS
---------------------------
Overlapping bands are the failure mode here. If 1-10 and 5-20 both exist for
one product, the price of 7 units depends on which row the query happens to
reach first - so the same order can be priced two ways, and a dealer who
noticed would be right to be angry.

An EXCLUDE constraint makes that state unrepresentable rather than merely
discouraged: Postgres refuses the INSERT.

The range is built half-open, `[min, max+1)`, because a person reads "11 to
50" as including 50 while Postgres stores ranges with an exclusive top. An
open-ended band (max_quantity NULL) becomes an int4range with a NULL upper
bound, which *is* unbounded above - so "51+" is a real range and still
collides with anything overlapping it.

The obvious-looking alternative is wrong, and was in this migration until it
was tested: `int4range(min, COALESCE(max, 2147483647), '[]')`. Postgres
normalises the inclusive top to max + 1, the sentinel becomes 2147483648,
and the insert dies with "integer out of range" - so the one band every
product actually needs, the open-ended top one, could not be created at all.
Hence ck_price_tier_max_headroom: max_quantity has to leave room for the + 1.

dealer_id is folded through COALESCE to the nil UUID so that NULL - "applies
to every dealer" - compares equal to itself; a bare NULL would not, and two
identical general tiers would both be accepted.

btree_gist is required for the equality parts of that constraint.

Revision ID: 202609300001
Revises: 202609290002
Create Date: 2026-09-30
"""
from typing import Sequence, Union

from alembic import op

revision: str = "202609300001"
down_revision: Union[str, None] = "202609290002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NIL = "'00000000-0000-0000-0000-000000000000'::uuid"


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    op.execute(
        f"""
        CREATE TABLE product_price_tiers (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            product_id      uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            dealer_id       uuid REFERENCES dealers(id) ON DELETE CASCADE,
            min_quantity    integer NOT NULL,
            max_quantity    integer,
            price           numeric(12, 2) NOT NULL,
            note            varchar(200),
            created_at      timestamptz NOT NULL DEFAULT now(),
            updated_at      timestamptz NOT NULL DEFAULT now(),
            created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
            updated_by      uuid REFERENCES users(id) ON DELETE SET NULL,

            CONSTRAINT ck_price_tier_min_positive
                CHECK (min_quantity >= 1),
            CONSTRAINT ck_price_tier_band_ordered
                CHECK (max_quantity IS NULL OR max_quantity >= min_quantity),
            CONSTRAINT ck_price_tier_price_positive
                CHECK (price > 0),
            -- The exclusion constraint below builds max_quantity + 1. Leave
            -- room for it, or that addition overflows int4 and the insert
            -- fails with a message about integers that explains nothing.
            CONSTRAINT ck_price_tier_max_headroom
                CHECK (max_quantity IS NULL OR max_quantity < 2147483647),

            -- No two bands for the same product (and the same dealer, where
            -- NULL means "any dealer") may overlap. See the module docstring.
            CONSTRAINT ex_price_tier_no_overlap EXCLUDE USING gist (
                product_id WITH =,
                (COALESCE(dealer_id, {_NIL})) WITH =,
                (int4range(
                    min_quantity,
                    CASE WHEN max_quantity IS NULL THEN NULL ELSE max_quantity + 1 END
                )) WITH &&
            )
        )
        """
    )

    op.execute(
        "CREATE INDEX ix_price_tier_lookup ON product_price_tiers "
        "(product_id, dealer_id, min_quantity)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS product_price_tiers")
    # btree_gist is left installed: dropping an extension another migration
    # or a DBA may rely on is not this migration's business.
