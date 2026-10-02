"""Field activity turned into business figures, for somebody with 30 seconds.

The audience is the owner of the company, not an analyst. That single fact
decides most of what is in here:

* Every number comes back with a **sentence** saying what it means. The
  sentence is built here, next to the query that produced the number, so the
  words and the figure can never drift apart. Putting the wording in the
  frontend would mean two places deciding what "growth" is.

* Nothing is invented. Where the data to answer a question does not exist,
  the answer is ``None`` and a sentence saying so - never a zero. A zero and
  an unknown look identical on a dashboard and mean opposite things: "we sold
  nothing" versus "nobody has entered the cost yet".

* Money is ``Decimal`` end to end. A rupee figure that renders as
  12599.999999999998 costs the whole screen its credibility.

WHERE REVENUE COMES FROM
------------------------
Two real sources, added together:

1. **Dealer orders** - ``order_items.unit_price * quantity``. Priced at the
   moment the order was placed.
2. **Field sales** - ``visit_sale_items.line_total``, added by migration
   202609300002. Rows written before that migration have no price and are
   counted as quantity only; they are reported separately rather than
   silently dropped or silently valued at today's price.

WHAT IS DELIBERATELY NOT HERE
-----------------------------
Profit is reported **only** for products that have a ``cost_price``. The
response carries how much of the revenue could be assessed, so "contribution
is 40%" is never read as covering the whole business when it covers a third
of it. A product with no cost is excluded from the profit maths entirely
rather than treated as costing nothing, which would report a 100% margin.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.config.company_time import company_today

# Below this many months of order history, a seasonal claim is not worth
# making. Twelve months is the minimum that can distinguish "this product
# sells in June" from "we happened to start selling in June".
_MONTHS_FOR_SEASONALITY = 12

# A month is a peak for a product when it runs this far above that product's
# average month. 40% is high enough that ordinary variation does not trip it.
_PEAK_THRESHOLD = Decimal("1.4")
_TROUGH_THRESHOLD = Decimal("0.6")

# Growth beyond this is worth an arrow; inside it, the month is "about the
# same" and saying "up 0.4%" would be noise presented as signal.
_MEANINGFUL_GROWTH = Decimal("2")

# A conversion rate below this many visits is arithmetic, not evidence: two
# visits and no sale is "0%", and a dashboard that calls that a problem is
# reporting noise as a finding.
_MIN_VISITS_FOR_A_VERDICT = 10

_MONTH_NAMES = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def _money(value: Any) -> Decimal:
    return Decimal(str(value)) if value is not None else Decimal("0")


def _rupees(value: Decimal) -> str:
    """Indian-format rupees, in the units a person actually says out loud.

    Nobody reads 4523000 as four and a half lakh at a glance, and the owner of
    this business thinks in lakhs and crores, not in millions.
    """
    amount = Decimal(value)
    if amount >= 10_000_000:
        return f"₹{amount / Decimal(10_000_000):.2f} crore"
    if amount >= 100_000:
        return f"₹{amount / Decimal(100_000):.2f} lakh"
    return f"₹{amount:,.0f}"


def _growth_percent(current: Decimal, previous: Decimal) -> Optional[Decimal]:
    """Percentage change, or None when there is nothing to compare against.

    Returning None rather than 100% when the previous period was zero matters:
    the first month of any new product would otherwise show "up 100%", which
    is not a fact about demand, it is a fact about division.
    """
    if previous <= 0:
        return None
    return ((current - previous) / previous * Decimal(100)).quantize(Decimal("0.1"))


def _month_start(day: dt.date) -> dt.date:
    return day.replace(day=1)


def _add_months(day: dt.date, months: int) -> dt.date:
    total = day.month - 1 + months
    return dt.date(day.year + total // 12, total % 12 + 1, 1)


@dataclass
class Figure:
    """One number, and what it means in words."""

    value: Optional[Decimal]
    display: str
    note: str
    direction: str = "flat"  # "up" | "down" | "flat" | "unknown"

    def as_dict(self) -> dict:
        return {
            "value": float(self.value) if self.value is not None else None,
            "display": self.display,
            "note": self.note,
            "direction": self.direction,
        }


@dataclass
class ManagementPeriod:
    """The window every figure on the dashboard is measured over."""

    today: dt.date
    this_month_start: dt.date
    next_month_start: dt.date
    last_month_start: dt.date
    # Last month is cut off at the same elapsed day as this month has reached,
    # so "up 12%" on the 5th is not comparing five days against thirty-one.
    last_month_cutoff: dt.date
    label: str = ""
    comparison_label: str = ""

    @classmethod
    def for_today(cls, today: Optional[dt.date] = None) -> "ManagementPeriod":
        today = today or company_today()
        this_start = _month_start(today)
        next_start = _add_months(this_start, 1)
        last_start = _add_months(this_start, -1)
        days_elapsed = (today - this_start).days + 1
        cutoff = min(last_start + dt.timedelta(days=days_elapsed), this_start)
        return cls(
            today=today,
            this_month_start=this_start,
            next_month_start=next_start,
            last_month_start=last_start,
            last_month_cutoff=cutoff,
            label=f"{_MONTH_NAMES[this_start.month]} {this_start.year}",
            comparison_label=(
                f"the first {days_elapsed} days of {_MONTH_NAMES[last_start.month]}"
            ),
        )


# ---------------------------------------------------------------------------
# Revenue
#
# One CTE reused by most queries below, so dealer orders and field sales are
# combined identically everywhere. Written once because two definitions of
# revenue is two revenues.
#
# Half-open [start, end) ranges on the raw timestamp column, so the index is
# usable and a sale at 23:59 on the last day is not lost.
# ---------------------------------------------------------------------------

_SALES_LINES_CTE = """
    WITH sale_lines AS (
        -- Dealer orders: priced when the order was placed.
        SELECT
            o.created_by                AS officer_id,
            oi.product_id               AS product_id,
            d.district                  AS district,
            o.order_date                AS sold_at,
            oi.quantity::numeric        AS quantity,
            (oi.unit_price * oi.quantity) AS line_value,
            o.id                        AS order_id,
            'dealer_order'              AS source
        FROM order_items oi
        JOIN dealer_orders o ON o.id = oi.order_id
        LEFT JOIN dealers d  ON d.id = o.dealer_id

        UNION ALL

        -- Field sales recorded on a visit. line_total is NULL for rows
        -- written before migration 202609300002; those carry quantity only
        -- and are reported as unvalued rather than dropped.
        SELECT
            v.user_id                   AS officer_id,
            vsi.product_id              AS product_id,
            COALESCE(f.district, dl.district) AS district,
            v.start_time                AS sold_at,
            vsi.quantity                AS quantity,
            vsi.line_total              AS line_value,
            NULL::uuid                  AS order_id,
            'field_sale'                AS source
        FROM visit_sale_items vsi
        JOIN visits v        ON v.id = vsi.visit_id
        LEFT JOIN farmers f  ON f.id = v.farmer_id
        LEFT JOIN dealers dl ON dl.id = v.dealer_id
    )
"""


class ManagementAnalyticsService:
    """Read-only. Every method returns figures plus the words to read them by."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ------------------------------------------------------------------ 1
    async def headline(self, period: ManagementPeriod) -> dict:
        """How much did we sell, and is it going up or down.

        The two questions the first screen has to answer before anything else.
        """
        row = (
            await self._session.execute(
                text(
                    _SALES_LINES_CTE
                    + """
                    SELECT
                        COALESCE(SUM(line_value) FILTER (
                            WHERE sold_at >= :this_start AND sold_at < :next_start
                        ), 0) AS this_month,
                        COALESCE(SUM(line_value) FILTER (
                            WHERE sold_at >= :last_start AND sold_at < :last_cutoff
                        ), 0) AS last_month_same_days,
                        COALESCE(SUM(quantity) FILTER (
                            WHERE sold_at >= :this_start AND sold_at < :next_start
                        ), 0) AS units_this_month,
                        COUNT(DISTINCT order_id) FILTER (
                            WHERE sold_at >= :this_start AND sold_at < :next_start
                        ) AS orders_this_month,
                        COUNT(DISTINCT officer_id) FILTER (
                            WHERE sold_at >= :this_start AND sold_at < :next_start
                        ) AS officers_selling,
                        COALESCE(SUM(quantity) FILTER (
                            WHERE line_value IS NULL
                              AND sold_at >= :this_start AND sold_at < :next_start
                        ), 0) AS unvalued_units
                    FROM sale_lines
                    """
                ).bindparams(
                    this_start=period.this_month_start,
                    next_start=period.next_month_start,
                    last_start=period.last_month_start,
                    last_cutoff=period.last_month_cutoff,
                )
            )
        ).one()

        this_month = _money(row.this_month)
        last_month = _money(row.last_month_same_days)
        growth = _growth_percent(this_month, last_month)

        if growth is None:
            direction, note = (
                ("up", f"First sales recorded in {period.label}.")
                if this_month > 0
                else ("unknown", "No sales recorded yet this month.")
            )
        elif growth >= _MEANINGFUL_GROWTH:
            direction = "up"
            note = f"Sales are up {growth}% compared with {period.comparison_label}."
        elif growth <= -_MEANINGFUL_GROWTH:
            direction = "down"
            note = f"Sales are down {abs(growth)}% compared with {period.comparison_label}."
        else:
            direction = "flat"
            note = f"Sales are about the same as {period.comparison_label}."

        unvalued = int(row.unvalued_units or 0)
        units_note = f"{int(row.units_this_month or 0):,} units sold this month."
        if unvalued:
            units_note += (
                f" {unvalued:,} of them were recorded before prices were captured "
                "on field sales, so their value is not included above."
            )

        return {
            "period_label": period.label,
            "total_sales": Figure(
                value=this_month,
                display=_rupees(this_month),
                note=note,
                direction=direction,
            ).as_dict(),
            "growth_percent": Figure(
                value=growth,
                display=f"{growth}%" if growth is not None else "—",
                note=(
                    "Nothing to compare against yet - last month had no sales."
                    if growth is None
                    else f"Measured against {period.comparison_label}."
                ),
                direction=direction,
            ).as_dict(),
            "units_sold": Figure(
                value=Decimal(int(row.units_this_month or 0)),
                display=f"{int(row.units_this_month or 0):,}",
                note=units_note,
            ).as_dict(),
            "orders": Figure(
                value=Decimal(int(row.orders_this_month or 0)),
                display=f"{int(row.orders_this_month or 0):,}",
                note="Dealer orders placed this month.",
            ).as_dict(),
            "officers_selling": Figure(
                value=Decimal(int(row.officers_selling or 0)),
                display=f"{int(row.officers_selling or 0):,}",
                note="Officers who generated at least one sale this month.",
            ).as_dict(),
        }

    # ------------------------------------------------------------------ 2
    async def contribution(self, period: ManagementPeriod) -> dict:
        """Profit, honestly - which means saying how much of it is unknown.

        Only products with a ``cost_price`` are included. The response carries
        the share of revenue that could be assessed so the percentage is never
        read as covering more of the business than it does.
        """
        row = (
            await self._session.execute(
                text(
                    _SALES_LINES_CTE
                    + """
                    SELECT
                        COALESCE(SUM(sl.line_value), 0) AS revenue_all,
                        COALESCE(SUM(sl.line_value) FILTER (
                            WHERE p.cost_price IS NOT NULL
                        ), 0) AS revenue_costed,
                        COALESCE(SUM(
                            (sl.line_value - (p.cost_price * sl.quantity))
                        ) FILTER (WHERE p.cost_price IS NOT NULL), 0) AS contribution,
                        COUNT(DISTINCT p.id) FILTER (
                            WHERE p.cost_price IS NULL
                        ) AS products_without_cost
                    FROM sale_lines sl
                    JOIN products p ON p.id = sl.product_id
                    WHERE sl.sold_at >= :this_start AND sl.sold_at < :next_start
                      AND sl.line_value IS NOT NULL
                    """
                ).bindparams(
                    this_start=period.this_month_start,
                    next_start=period.next_month_start,
                )
            )
        ).one()

        revenue_all = _money(row.revenue_all)
        revenue_costed = _money(row.revenue_costed)
        contribution = _money(row.contribution)
        missing = int(row.products_without_cost or 0)

        if revenue_costed <= 0:
            return {
                "available": False,
                "contribution": Figure(
                    value=None,
                    display="Not available",
                    note=(
                        "Profit cannot be shown because no product has a cost price "
                        "entered yet. Add the cost of each product on the Products "
                        "page and this fills in automatically."
                        if missing
                        else "No sales with a cost price recorded this month."
                    ),
                    direction="unknown",
                ).as_dict(),
                "coverage_percent": None,
                "products_without_cost": missing,
            }

        margin = (contribution / revenue_costed * Decimal(100)).quantize(Decimal("0.1"))
        coverage = (
            (revenue_costed / revenue_all * Decimal(100)).quantize(Decimal("0.1"))
            if revenue_all > 0
            else Decimal("0")
        )

        note = f"{margin}% of the sales we can cost is contribution."
        if coverage < Decimal("99"):
            note += (
                f" This covers {coverage}% of this month's sales - "
                f"{missing} product(s) still have no cost price entered."
            )

        return {
            "available": True,
            "contribution": Figure(
                value=contribution,
                display=_rupees(contribution),
                note=note,
                direction="up" if contribution > 0 else "down",
            ).as_dict(),
            "margin_percent": float(margin),
            "coverage_percent": float(coverage),
            "products_without_cost": missing,
        }

    # ------------------------------------------------------------------ 3
    async def officers(self, period: ManagementPeriod) -> list[dict]:
        """Every officer's month, from visits through to money.

        One row per active officer, including officers who sold nothing -
        leaving them out would hide exactly the people who need attention.
        """
        rows = (
            await self._session.execute(
                text(
                    _SALES_LINES_CTE
                    + """
                    , officer_sales AS (
                        SELECT
                            officer_id,
                            COALESCE(SUM(line_value), 0) AS sales_value,
                            COALESCE(SUM(quantity), 0)   AS units,
                            COUNT(DISTINCT order_id)     AS orders,
                            COUNT(DISTINCT product_id)   AS products,
                            COUNT(DISTINCT district) FILTER (WHERE district IS NOT NULL)
                                                         AS districts
                        FROM sale_lines
                        WHERE sold_at >= :this_start AND sold_at < :next_start
                        GROUP BY officer_id
                    ),
                    officer_prev AS (
                        SELECT officer_id, COALESCE(SUM(line_value), 0) AS sales_value
                        FROM sale_lines
                        WHERE sold_at >= :last_start AND sold_at < :last_cutoff
                        GROUP BY officer_id
                    ),
                    officer_visits AS (
                        SELECT
                            v.user_id AS officer_id,
                            COUNT(*)                                        AS visits,
                            COUNT(DISTINCT v.farmer_id) FILTER (WHERE v.farmer_id IS NOT NULL) AS farmers,
                            COUNT(DISTINCT v.dealer_id) FILTER (WHERE v.dealer_id IS NOT NULL) AS dealers,
                            COUNT(*) FILTER (WHERE v.next_visit_date IS NOT NULL) AS follow_ups_planned,
                            COUNT(*) FILTER (
                                WHERE v.next_visit_date IS NOT NULL
                                  AND v.next_visit_date < :today
                            ) AS follow_ups_due
                        FROM visits v
                        WHERE v.start_time >= :this_start AND v.start_time < :next_start
                        GROUP BY v.user_id
                    ),
                    officer_new_contacts AS (
                        SELECT created_by AS officer_id,
                               COUNT(*) AS new_farmers
                        FROM farmers
                        WHERE created_at >= :this_start AND created_at < :next_start
                          AND is_deleted = false
                        GROUP BY created_by
                    ),
                    officer_target AS (
                        SELECT officer_id, target_value
                        FROM officer_monthly_targets
                        WHERE metric = 'sales_value' AND period = :this_start
                    )
                    SELECT
                        u.id                AS officer_id,
                        u.full_name         AS name,
                        u.role              AS role,
                        u.employee_id       AS employee_id,
                        COALESCE(s.sales_value, 0)  AS sales_value,
                        COALESCE(pv.sales_value, 0) AS prev_sales_value,
                        COALESCE(s.units, 0)        AS units,
                        COALESCE(s.orders, 0)       AS orders,
                        COALESCE(s.products, 0)     AS products,
                        COALESCE(s.districts, 0)    AS districts,
                        COALESCE(vi.visits, 0)              AS visits,
                        COALESCE(vi.farmers, 0)             AS farmers,
                        COALESCE(vi.dealers, 0)             AS dealers,
                        COALESCE(vi.follow_ups_planned, 0)  AS follow_ups_planned,
                        COALESCE(vi.follow_ups_due, 0)      AS follow_ups_due,
                        COALESCE(nc.new_farmers, 0)         AS new_farmers,
                        t.target_value                      AS target_value
                    FROM users u
                    LEFT JOIN officer_sales s        ON s.officer_id = u.id
                    LEFT JOIN officer_prev pv        ON pv.officer_id = u.id
                    LEFT JOIN officer_visits vi      ON vi.officer_id = u.id
                    LEFT JOIN officer_new_contacts nc ON nc.officer_id = u.id
                    LEFT JOIN officer_target t       ON t.officer_id = u.id
                    WHERE u.role IN ('field_officer', 'sales_officer')
                      AND u.is_active = true AND u.is_deleted = false
                    ORDER BY COALESCE(s.sales_value, 0) DESC, u.full_name ASC
                    """
                ).bindparams(
                    this_start=period.this_month_start,
                    next_start=period.next_month_start,
                    last_start=period.last_month_start,
                    last_cutoff=period.last_month_cutoff,
                    today=period.today,
                )
            )
        ).all()

        total_districts = (
            await self._session.execute(
                text("SELECT COUNT(DISTINCT district) FROM dealers WHERE is_deleted = false")
            )
        ).scalar_one_or_none() or 0

        officers: list[dict] = []
        for rank, row in enumerate(rows, 1):
            sales = _money(row.sales_value)
            previous = _money(row.prev_sales_value)
            growth = _growth_percent(sales, previous)
            target = _money(row.target_value) if row.target_value is not None else None

            achievement = (
                (sales / target * Decimal(100)).quantize(Decimal("0.1"))
                if target and target > 0
                else None
            )

            officers.append(
                {
                    "officer_id": str(row.officer_id),
                    "name": row.name,
                    "role": row.role,
                    "employee_id": row.employee_id,
                    "rank": rank,
                    "visits": int(row.visits),
                    "farmers_contacted": int(row.farmers),
                    "dealers_contacted": int(row.dealers),
                    "orders": int(row.orders),
                    "products_sold": int(row.products),
                    "units_sold": int(_money(row.units)),
                    "new_farmers": int(row.new_farmers),
                    "follow_ups_planned": int(row.follow_ups_planned),
                    "follow_ups_due": int(row.follow_ups_due),
                    "follow_up_note": self._follow_up_note(
                        int(row.follow_ups_planned), int(row.follow_ups_due)
                    ),
                    "districts_covered": int(row.districts),
                    "districts_total": int(total_districts),
                    "coverage_note": self._coverage_note(
                        int(row.districts), int(total_districts)
                    ),
                    "sales_value": float(sales),
                    "sales_display": _rupees(sales),
                    "growth_percent": float(growth) if growth is not None else None,
                    "target_value": float(target) if target is not None else None,
                    "target_display": _rupees(target) if target is not None else None,
                    "achievement_percent": float(achievement)
                    if achievement is not None
                    else None,
                    "target_note": self._target_note(target, achievement),
                    "milestone": self._milestone(
                        visits=int(row.visits),
                        farmers=int(row.farmers),
                        orders=int(row.orders),
                        products=int(row.products),
                        achievement=achievement,
                    ),
                    "headline": self._officer_headline(
                        row.name, sales, growth, achievement, int(row.visits)
                    ),
                    "needs_attention": self._needs_attention(
                        sales=sales,
                        visits=int(row.visits),
                        achievement=achievement,
                        follow_ups_due=int(row.follow_ups_due),
                    ),
                }
            )
        return officers

    # --- wording helpers, kept beside the numbers they describe ------------

    _MILESTONE_STAGES = [
        "Started",
        "Visits Completed",
        "Farmers Reached",
        "Orders Generated",
        "Products Sold",
        "Target Achieved",
    ]

    def _milestone(
        self,
        visits: int,
        farmers: int,
        orders: int,
        products: int,
        achievement: Optional[Decimal],
    ) -> dict:
        """How far through the month's journey this officer has got.

        The stages are cumulative and in the order the work actually happens,
        so the furthest one reached is the officer's stage. "Target Achieved"
        needs a target to exist: without one the officer stops at "Products
        Sold" and the reason is stated, rather than the stage looking like a
        failure when nobody set a number to hit.
        """
        reached = 0  # Started
        if visits > 0:
            reached = 1
        if farmers > 0:
            reached = 2
        if orders > 0:
            reached = 3
        if products > 0:
            reached = 4
        if achievement is not None and achievement >= Decimal(100):
            reached = 5

        if achievement is None and reached == 4:
            note = "No sales target set for this month, so the last stage cannot be reached."
        elif reached == 5:
            note = "Target reached for this month."
        elif reached == 0:
            note = "No visits recorded yet this month."
        else:
            note = f"Next step: {self._MILESTONE_STAGES[reached + 1]}."

        return {
            "stages": self._MILESTONE_STAGES,
            "reached_index": reached,
            "current_stage": self._MILESTONE_STAGES[reached],
            "note": note,
        }

    @staticmethod
    def _target_note(target: Optional[Decimal], achievement: Optional[Decimal]) -> str:
        if target is None:
            return "No sales target set for this officer this month."
        if achievement is None:
            return "Target is zero, so achievement cannot be worked out."
        if achievement >= Decimal(100):
            return f"Target achieved - {achievement}% of the month's target."
        if achievement >= Decimal(75):
            return f"Close to target - {achievement}% reached."
        return f"{achievement}% of the month's target so far."

    @staticmethod
    def _follow_up_note(planned: int, due: int) -> str:
        if planned == 0:
            return "No follow-up visits planned this month."
        if due == 0:
            return f"All {planned} planned follow-ups are still on schedule."
        return f"{due} of {planned} follow-up visits are past their date."

    @staticmethod
    def _coverage_note(covered: int, total: int) -> str:
        if total == 0:
            return "No districts on record yet."
        if covered == 0:
            return f"No sales in any of the {total} districts this month."
        if covered >= total:
            return f"Sold in all {total} districts."
        return f"Sold in {covered} of {total} districts."

    @staticmethod
    def _officer_headline(
        name: str,
        sales: Decimal,
        growth: Optional[Decimal],
        achievement: Optional[Decimal],
        visits: int,
    ) -> str:
        first = (name or "This officer").split()[0]
        if sales <= 0:
            if visits > 0:
                return f"{first} made {visits} visits but no sales yet this month."
            return f"{first} has no visits or sales recorded this month."
        parts = [f"{first} sold {_rupees(sales)} this month"]
        if achievement is not None:
            parts.append(
                "and has passed the target"
                if achievement >= Decimal(100)
                else f"and is at {achievement}% of target"
            )
        if growth is not None and abs(growth) >= _MEANINGFUL_GROWTH:
            parts.append(
                f"({'up' if growth > 0 else 'down'} {abs(growth)}% on last month)"
            )
        return " ".join(parts) + "."

    @staticmethod
    def _needs_attention(
        sales: Decimal,
        visits: int,
        achievement: Optional[Decimal],
        follow_ups_due: int,
    ) -> Optional[str]:
        """One reason this officer should be looked at, or None.

        One reason and not a list: a dashboard meant to be read in thirty
        seconds cannot afford three warnings per person. They are ordered by
        how much they matter, and the first that applies is the one shown.
        """
        if visits == 0 and sales <= 0:
            return "No activity recorded this month"
        if sales <= 0:
            return "Visits are happening but no sales yet"
        if achievement is not None and achievement < Decimal(50):
            return f"Below half of target ({achievement}%)"
        if follow_ups_due > 0:
            return f"{follow_ups_due} follow-up visit(s) overdue"
        return None

    # ------------------------------------------------------------------ 4
    async def products(self, period: ManagementPeriod) -> dict:
        """Which products sell, who sells them, and which have gone quiet."""
        rows = (
            await self._session.execute(
                text(
                    _SALES_LINES_CTE
                    + """
                    SELECT
                        p.id   AS product_id,
                        p.name AS name,
                        p.sku_code AS sku_code,
                        p.category AS category,
                        p.cost_price IS NOT NULL AS has_cost,
                        COALESCE(SUM(sl.line_value) FILTER (
                            WHERE sl.sold_at >= :this_start AND sl.sold_at < :next_start
                        ), 0) AS revenue,
                        COALESCE(SUM(sl.quantity) FILTER (
                            WHERE sl.sold_at >= :this_start AND sl.sold_at < :next_start
                        ), 0) AS units,
                        COALESCE(SUM(sl.line_value) FILTER (
                            WHERE sl.sold_at >= :last_start AND sl.sold_at < :last_cutoff
                        ), 0) AS prev_revenue,
                        MAX(sl.sold_at) AS last_sold_at
                    FROM products p
                    LEFT JOIN sale_lines sl ON sl.product_id = p.id
                    WHERE p.is_active = true
                    GROUP BY p.id, p.name, p.sku_code, p.category, p.cost_price
                    ORDER BY revenue DESC, p.name ASC
                    """
                ).bindparams(
                    this_start=period.this_month_start,
                    next_start=period.next_month_start,
                    last_start=period.last_month_start,
                    last_cutoff=period.last_month_cutoff,
                )
            )
        ).all()

        total_revenue = sum((_money(r.revenue) for r in rows), Decimal("0"))

        items: list[dict] = []
        for row in rows:
            revenue = _money(row.revenue)
            previous = _money(row.prev_revenue)
            growth = _growth_percent(revenue, previous)
            share = (
                (revenue / total_revenue * Decimal(100)).quantize(Decimal("0.1"))
                if total_revenue > 0
                else Decimal("0")
            )
            items.append(
                {
                    "product_id": str(row.product_id),
                    "name": row.name,
                    "sku_code": row.sku_code,
                    "category": row.category,
                    "has_cost_price": bool(row.has_cost),
                    "revenue": float(revenue),
                    "revenue_display": _rupees(revenue),
                    "units": int(_money(row.units)),
                    "share_percent": float(share),
                    "growth_percent": float(growth) if growth is not None else None,
                    "last_sold_at": row.last_sold_at.isoformat() if row.last_sold_at else None,
                    "note": self._product_note(row.name, revenue, growth, share),
                }
            )

        selling = [i for i in items if i["revenue"] > 0]
        quiet = [i for i in items if i["revenue"] <= 0]

        return {
            "period_label": period.label,
            "total_revenue": float(total_revenue),
            "total_revenue_display": _rupees(total_revenue),
            "products": items,
            "top": selling[0] if selling else None,
            "slow_moving": quiet,
            "slow_moving_note": (
                f"{len(quiet)} product(s) had no sales at all in {period.label}."
                if quiet
                else "Every active product sold at least once this month."
            ),
        }

    @staticmethod
    def _product_note(
        name: str, revenue: Decimal, growth: Optional[Decimal], share: Decimal
    ) -> str:
        if revenue <= 0:
            return f"{name} has not sold at all this month."
        sentence = f"{name} brought in {_rupees(revenue)}, {share}% of this month's sales."
        if growth is not None and growth >= _MEANINGFUL_GROWTH:
            sentence += f" Sales are growing - up {growth}% on last month."
        elif growth is not None and growth <= -_MEANINGFUL_GROWTH:
            sentence += f" Sales are falling - down {abs(growth)}% on last month."
        return sentence

    # ------------------------------------------------------------------ 5
    async def officer_product_matrix(self, period: ManagementPeriod) -> list[dict]:
        """Who is selling more of which product - the question as asked."""
        rows = (
            await self._session.execute(
                text(
                    _SALES_LINES_CTE
                    + """
                    SELECT
                        u.full_name AS officer_name,
                        u.id        AS officer_id,
                        p.name      AS product_name,
                        p.id        AS product_id,
                        COALESCE(SUM(sl.line_value), 0) AS revenue,
                        COALESCE(SUM(sl.quantity), 0)   AS units
                    FROM sale_lines sl
                    JOIN users u    ON u.id = sl.officer_id
                    JOIN products p ON p.id = sl.product_id
                    WHERE sl.sold_at >= :this_start AND sl.sold_at < :next_start
                    GROUP BY u.id, u.full_name, p.id, p.name
                    HAVING COALESCE(SUM(sl.quantity), 0) > 0
                    ORDER BY revenue DESC
                    """
                ).bindparams(
                    this_start=period.this_month_start,
                    next_start=period.next_month_start,
                )
            )
        ).all()
        return [
            {
                "officer_id": str(r.officer_id),
                "officer_name": r.officer_name,
                "product_id": str(r.product_id),
                "product_name": r.product_name,
                "revenue": float(_money(r.revenue)),
                "revenue_display": _rupees(_money(r.revenue)),
                "units": int(_money(r.units)),
            }
            for r in rows
        ]

    # ------------------------------------------------------------------ 6
    async def territories(self, period: ManagementPeriod) -> dict:
        """Where products are selling, by district."""
        rows = (
            await self._session.execute(
                text(
                    _SALES_LINES_CTE
                    + """
                    SELECT
                        COALESCE(sl.district, 'Not recorded') AS district,
                        COALESCE(SUM(sl.line_value) FILTER (
                            WHERE sl.sold_at >= :this_start AND sl.sold_at < :next_start
                        ), 0) AS revenue,
                        COALESCE(SUM(sl.line_value) FILTER (
                            WHERE sl.sold_at >= :last_start AND sl.sold_at < :last_cutoff
                        ), 0) AS prev_revenue,
                        COUNT(DISTINCT sl.officer_id) FILTER (
                            WHERE sl.sold_at >= :this_start AND sl.sold_at < :next_start
                        ) AS officers
                    FROM sale_lines sl
                    GROUP BY COALESCE(sl.district, 'Not recorded')
                    ORDER BY revenue DESC
                    """
                ).bindparams(
                    this_start=period.this_month_start,
                    next_start=period.next_month_start,
                    last_start=period.last_month_start,
                    last_cutoff=period.last_month_cutoff,
                )
            )
        ).all()

        items = []
        for row in rows:
            revenue = _money(row.revenue)
            growth = _growth_percent(revenue, _money(row.prev_revenue))
            items.append(
                {
                    "district": row.district,
                    "revenue": float(revenue),
                    "revenue_display": _rupees(revenue),
                    "officers": int(row.officers or 0),
                    "growth_percent": float(growth) if growth is not None else None,
                    "note": (
                        f"{row.district} brought in {_rupees(revenue)} this month."
                        + (
                            f" That is {'up' if growth > 0 else 'down'} {abs(growth)}% on last month."
                            if growth is not None and abs(growth) >= _MEANINGFUL_GROWTH
                            else ""
                        )
                    ),
                }
            )

        best = items[0] if items and items[0]["revenue"] > 0 else None
        return {
            "districts": items,
            "best": best,
            "note": (
                f"{best['district']} is the strongest district this month."
                if best
                else "No district has recorded sales this month."
            ),
        }

    # ------------------------------------------------------------------ 7
    async def seasonality(self, period: ManagementPeriod, months: int = 24) -> dict:
        """Which products sell in which months - if there is enough history.

        Seasonality is the one thing on this dashboard that cannot be
        conjured from a short period. With three months of data, "Product A
        sells more in June" is not a finding, it is the shape of whatever
        happened to be recorded. So the history is measured first, and if it
        is too short the answer is that it is too short - with how much longer
        to wait - rather than a confident line through noise.
        """
        window_start = _add_months(period.this_month_start, -months)

        span = (
            await self._session.execute(
                text(
                    _SALES_LINES_CTE
                    + """
                    SELECT
                        MIN(sold_at) AS first_sale,
                        MAX(sold_at) AS last_sale,
                        COUNT(DISTINCT date_trunc('month', sold_at)) AS months_with_sales
                    FROM sale_lines
                    WHERE line_value IS NOT NULL
                    """
                )
            )
        ).one()

        months_with_sales = int(span.months_with_sales or 0)

        series = (
            await self._session.execute(
                text(
                    _SALES_LINES_CTE
                    + """
                    SELECT
                        p.id   AS product_id,
                        p.name AS name,
                        EXTRACT(YEAR FROM sl.sold_at)::int  AS year,
                        EXTRACT(MONTH FROM sl.sold_at)::int AS month,
                        COALESCE(SUM(sl.line_value), 0) AS revenue,
                        COALESCE(SUM(sl.quantity), 0)   AS units
                    FROM sale_lines sl
                    JOIN products p ON p.id = sl.product_id
                    WHERE sl.sold_at >= :window_start
                      AND sl.sold_at < :next_start
                      AND sl.line_value IS NOT NULL
                    GROUP BY p.id, p.name, year, month
                    ORDER BY p.name, year, month
                    """
                ).bindparams(
                    window_start=window_start, next_start=period.next_month_start
                )
            )
        ).all()

        by_product: dict[str, dict] = {}
        for row in series:
            entry = by_product.setdefault(
                str(row.product_id),
                {"product_id": str(row.product_id), "name": row.name, "points": []},
            )
            entry["points"].append(
                {
                    "year": row.year,
                    "month": row.month,
                    "label": f"{_MONTH_NAMES[row.month][:3]} {str(row.year)[2:]}",
                    "revenue": float(_money(row.revenue)),
                    "units": int(_money(row.units)),
                }
            )

        enough = months_with_sales >= _MONTHS_FOR_SEASONALITY
        insights: list[dict] = []

        if enough:
            for entry in by_product.values():
                insight = self._seasonal_insight(entry["name"], entry["points"])
                if insight:
                    insights.append({"product_id": entry["product_id"], **insight})

        return {
            "has_enough_history": enough,
            "months_with_sales": months_with_sales,
            "months_needed": _MONTHS_FOR_SEASONALITY,
            "first_sale": span.first_sale.isoformat() if span.first_sale else None,
            "history_note": (
                f"Based on {months_with_sales} months of sales history."
                if enough
                else (
                    f"Seasonal patterns need at least {_MONTHS_FOR_SEASONALITY} months "
                    f"of sales history to be reliable. There are {months_with_sales} "
                    f"so far, so no seasonal claims are made yet."
                )
            ),
            "products": list(by_product.values()),
            "insights": insights,
        }

    @staticmethod
    def _seasonal_insight(name: str, points: list[dict]) -> Optional[dict]:
        """Which months this product runs hot, in a sentence.

        Averages each calendar month across every year in the window, so a
        single exceptional June does not become "June is the season". A month
        has to sit 40% above the product's own average to count, which is far
        enough out that ordinary variation does not trip it.
        """
        if len(points) < _MONTHS_FOR_SEASONALITY:
            return None

        by_month: dict[int, list[Decimal]] = {}
        for point in points:
            by_month.setdefault(point["month"], []).append(Decimal(str(point["revenue"])))

        # Every calendar month needs at least one observation before comparing.
        monthly_avg = {
            month: sum(values) / Decimal(len(values)) for month, values in by_month.items()
        }
        if len(monthly_avg) < 6:
            return None

        overall = sum(monthly_avg.values()) / Decimal(len(monthly_avg))
        if overall <= 0:
            return None

        peaks = sorted(
            (m for m, v in monthly_avg.items() if v / overall >= _PEAK_THRESHOLD)
        )
        troughs = sorted(
            (m for m, v in monthly_avg.items() if v / overall <= _TROUGH_THRESHOLD)
        )

        if not peaks:
            return {
                "name": name,
                "peak_months": [],
                "low_months": [m for m in troughs],
                "sentence": f"{name} sells fairly evenly through the year.",
            }

        def phrase(months: list[int]) -> str:
            names = [_MONTH_NAMES[m] for m in months]
            # Consecutive months read as a range, which is how a person would
            # say it: "June to August", not "June, July and August".
            if len(months) > 1 and months == list(range(months[0], months[-1] + 1)):
                return f"{names[0]} to {names[-1]}"
            if len(names) == 1:
                return names[0]
            return ", ".join(names[:-1]) + f" and {names[-1]}"

        sentence = f"{name} usually sells more from {phrase(peaks)}."
        if troughs:
            sentence += f" Demand is lowest around {phrase(troughs)}."

        return {
            "name": name,
            "peak_months": peaks,
            "low_months": troughs,
            "sentence": sentence,
        }

    # ------------------------------------------------------------------ 8
    async def activity_to_business(self, period: ManagementPeriod) -> dict:
        """Are field activities actually generating business.

        The funnel the owner asked for: visits, then the visits that converted,
        then orders, then money. The conversion rate is the honest link between
        effort and result, and it is the number that says whether the field
        force is working.
        """
        row = (
            await self._session.execute(
                text(
                    """
                    SELECT
                        (SELECT COUNT(*) FROM visits
                          WHERE start_time >= :this_start AND start_time < :next_start)
                            AS visits,
                        (SELECT COUNT(DISTINCT v.id)
                           FROM visits v
                           JOIN visit_sale_items vsi ON vsi.visit_id = v.id
                          WHERE v.start_time >= :this_start AND v.start_time < :next_start)
                            AS visits_with_sale,
                        (SELECT COUNT(*) FROM dealer_orders
                          WHERE order_date >= :this_start AND order_date < :next_start)
                            AS orders,
                        (SELECT COUNT(*) FROM farmers
                          WHERE created_at >= :this_start AND created_at < :next_start
                            AND is_deleted = false)
                            AS new_farmers,
                        (SELECT COUNT(*) FROM dealers
                          WHERE created_at >= :this_start AND created_at < :next_start
                            AND is_deleted = false)
                            AS new_dealers
                    """
                ).bindparams(
                    this_start=period.this_month_start,
                    next_start=period.next_month_start,
                )
            )
        ).one()

        visits = int(row.visits or 0)
        converted = int(row.visits_with_sale or 0)
        rate = (
            (Decimal(converted) / Decimal(visits) * Decimal(100)).quantize(Decimal("0.1"))
            if visits > 0
            else None
        )

        if rate is None:
            note = "No visits recorded this month, so there is nothing to convert yet."
        elif visits < _MIN_VISITS_FOR_A_VERDICT:
            # A rate off a handful of visits is arithmetic, not evidence. Two
            # visits and no sale is 0%, and telling the owner his field force
            # is failing on that basis would be worse than saying nothing.
            note = (
                f"{converted} of {visits} visits led to a sale. Too few visits so far "
                "this month to read anything into the rate."
            )
        elif rate >= Decimal(40):
            note = f"{rate}% of visits led to a sale - field work is converting well."
        elif rate >= Decimal(15):
            note = f"{rate}% of visits led to a sale."
        else:
            note = (
                f"Only {rate}% of visits led to a sale - worth looking at what is "
                "happening in the field."
            )

        return {
            "visits": visits,
            "visits_with_sale": converted,
            "conversion_percent": float(rate) if rate is not None else None,
            "orders": int(row.orders or 0),
            "new_farmers": int(row.new_farmers or 0),
            "new_dealers": int(row.new_dealers or 0),
            "note": note,
        }

    # ------------------------------------------------------------------ 9
    async def monthly_trend(self, period: ManagementPeriod, months: int = 12) -> dict:
        """Total sales month by month, for the one line chart on the page."""
        window_start = _add_months(period.this_month_start, -(months - 1))
        rows = (
            await self._session.execute(
                text(
                    _SALES_LINES_CTE
                    + """
                    SELECT
                        EXTRACT(YEAR FROM sold_at)::int  AS year,
                        EXTRACT(MONTH FROM sold_at)::int AS month,
                        COALESCE(SUM(line_value), 0) AS revenue
                    FROM sale_lines
                    WHERE sold_at >= :window_start AND sold_at < :next_start
                      AND line_value IS NOT NULL
                    GROUP BY year, month
                    ORDER BY year, month
                    """
                ).bindparams(
                    window_start=window_start, next_start=period.next_month_start
                )
            )
        ).all()

        points = [
            {
                "year": r.year,
                "month": r.month,
                "label": f"{_MONTH_NAMES[r.month][:3]} {str(r.year)[2:]}",
                "revenue": float(_money(r.revenue)),
                "revenue_display": _rupees(_money(r.revenue)),
            }
            for r in rows
        ]

        note = "Not enough history to show a trend yet."
        if len(points) >= 2:
            best = max(points, key=lambda p: p["revenue"])
            note = (
                f"Best month in this period was {best['label']} at "
                f"{best['revenue_display']}."
            )

        return {"points": points, "note": note}
