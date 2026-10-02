"""What a price is, and which one wins.

Before this existed the order line took ``products.price`` and nothing else,
so a dealer buying 500 units paid the same rate as one buying 2, and any
discount an officer had promised in the field had to be typed in by hand or
not at all.

PRECEDENCE — most specific wins
-------------------------------
1. a tier for *this dealer* whose band contains the quantity
2. a general tier (``dealer_id IS NULL``) whose band contains the quantity
3. ``products.price`` — the list price, and the fallback

Step 3 is why adding tiered pricing breaks nothing: a product with no tiers
prices exactly as it did before.

Only one row can ever match at each of steps 1 and 2, because overlapping
bands are refused by the database (``ex_price_tier_no_overlap``, migration
202609300001). So "the matching tier" is a fact, not a coin toss dressed up
as a query — the ordering in the repository picks between *levels* of
specificity, never between rival rows at the same level.

This module holds no SQL. The query lives behind ``DealerRepository`` so the
domain does not depend on the database driver; what is here is the shape of
an answer and the words used to describe it.

Money is ``Decimal`` throughout. ``float`` for money is how a dealer ends up
looking at a total of 12599.999999999998 and losing confidence in every
other number on the page.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

# Where a resolved price came from. Shown to the user, so an officer can see
# *why* a line is priced the way it is rather than having to trust it.
PRICE_SOURCE_DEALER_TIER = "dealer_tier"
PRICE_SOURCE_GENERAL_TIER = "general_tier"
PRICE_SOURCE_LIST = "list_price"

_SOURCE_LABELS = {
    PRICE_SOURCE_DEALER_TIER: "dealer rate",
    PRICE_SOURCE_GENERAL_TIER: "quantity rate",
    PRICE_SOURCE_LIST: "list price",
}


@dataclass(frozen=True)
class ResolvedPrice:
    """What was charged, and why — so the answer can be shown, not just used."""

    price: Decimal
    source: str
    tier_id: Optional[uuid.UUID] = None
    min_quantity: Optional[int] = None
    max_quantity: Optional[int] = None
    note: Optional[str] = None

    @property
    def source_label(self) -> str:
        return _SOURCE_LABELS.get(self.source, self.source)

    @property
    def band_label(self) -> str:
        """The band in the words a person would use for it."""
        if self.min_quantity is None:
            return "list price"
        if self.max_quantity is None:
            return f"{self.min_quantity}+ units"
        if self.max_quantity == self.min_quantity:
            unit = "unit" if self.min_quantity == 1 else "units"
            return f"{self.min_quantity} {unit}"
        return f"{self.min_quantity}–{self.max_quantity} units"

    @property
    def is_tiered(self) -> bool:
        return self.source != PRICE_SOURCE_LIST


def line_total(resolved: ResolvedPrice, quantity: int) -> Decimal:
    """Unit price times quantity, in Decimal, with no float anywhere near it."""
    return resolved.price * Decimal(quantity)


def merge_quantities(lines: list[tuple[uuid.UUID, int]]) -> dict[uuid.UUID, int]:
    """Total the quantity per product across an order's lines.

    A dealer who orders the same product on two lines of 5 is buying 10, and
    must be priced at 10. Pricing each line separately would quietly deny the
    discount the order has earned — and the dealer would be the one to notice.
    """
    totals: dict[uuid.UUID, int] = {}
    for product_id, quantity in lines:
        totals[product_id] = totals.get(product_id, 0) + quantity
    return totals


def validate_band(min_quantity: int, max_quantity: Optional[int]) -> None:
    """Reject a band that cannot mean anything, with a message a person can act on.

    The database enforces all of this too. This exists so the user is told
    what is wrong with what they typed, instead of being shown a constraint
    name from Postgres.
    """
    if min_quantity < 1:
        raise ValueError(
            f"The smallest quantity in a band must be at least 1 (got {min_quantity})."
        )
    if max_quantity is not None:
        if max_quantity < min_quantity:
            raise ValueError(
                f"The band {min_quantity}–{max_quantity} ends before it begins. "
                "Leave the top blank for an open-ended band such as \"51 and above\"."
            )
        if max_quantity >= 2147483647:
            raise ValueError(
                "That upper quantity is too large to store. Leave the top blank "
                "for an open-ended band instead."
            )


def validate_price(price: Decimal) -> None:
    if price <= 0:
        raise ValueError(f"A price must be greater than zero (got {price}).")


# The band-resolution query, as SQL, for callers that hold a raw session
# rather than the dealer repository.
#
# It is the same rule the repository implements, kept in one place so a field
# sale and a dealer order for the same product and quantity can never be
# priced differently. Two copies of a pricing rule is two prices.
RESOLVE_PRICE_SQL = """
    SELECT COALESCE(
        (
            SELECT t.price
            FROM product_price_tiers t
            WHERE t.product_id = CAST(:product_id AS UUID)
              AND (
                    t.dealer_id IS NULL
                    OR (
                        CAST(:dealer_id AS UUID) IS NOT NULL
                        AND t.dealer_id = CAST(:dealer_id AS UUID)
                    )
                  )
              AND t.min_quantity <= :quantity
              AND (t.max_quantity IS NULL OR t.max_quantity >= :quantity)
            ORDER BY (t.dealer_id IS NOT NULL) DESC
            LIMIT 1
        ),
        (SELECT p.price FROM products p WHERE p.id = CAST(:product_id AS UUID))
    ) AS unit_price
"""
