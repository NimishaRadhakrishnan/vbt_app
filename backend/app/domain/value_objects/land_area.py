"""
Land area units.

The application captures and reports land area in CENTS.

    1 acre = 100 cents

Kept as a named constant with helpers rather than a bare `* 100`
scattered through the code: a magic 100 in a pricing or quantity
context is indistinguishable from a percentage, and this is exactly the
kind of unit that gets silently mis-scaled during a later refactor.

Deliberately NOT applied to weight (kg), hectares or square feet -
those are separate measurements and were out of scope.
"""

from __future__ import annotations

from typing import Optional

CENTS_PER_ACRE = 100

# Shown in the UI so the unit is never ambiguous to an officer.
CONVERSION_NOTE = "1 acre = 100 cents"


def acres_to_cents(acres: Optional[float]) -> Optional[float]:
    """Convert a legacy acre value to cents. 0.5 acre -> 50 cents."""
    if acres is None:
        return None
    return acres * CENTS_PER_ACRE


def cents_to_acres(cents: Optional[float]) -> Optional[float]:
    """Inverse, for anything that still needs to report in acres
    (e.g. an external body that requires acres)."""
    if cents is None:
        return None
    return cents / CENTS_PER_ACRE
