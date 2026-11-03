"""
Read-side queries for the KPI engine.

Everything the engine counts comes from tables the field staff already
fill in (visits, trial details, day closures, leave, dealer orders) plus
the admin-entered goals and sales figures. Nothing here writes.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.config.company_time import is_weekly_working_day
from app.infrastructure.config.settings import get_settings

# demo stages that mean "the farmer agreed for a demo" (or went further)
AGREED_STAGES = (
    "agreed_not_started", "started_today", "followup_running",
    "completed_success", "completed_failed", "converted",
)
# order statuses that do not count as a real order
NOT_AN_ORDER = ("draft", "cancelled")


@dataclass
class Officer:
    id: uuid.UUID
    role: str
    work_mode: str
    manager_id: Optional[uuid.UUID]


def months_in(start: date, end: date) -> list[tuple[int, int]]:
    out, y, m = [], start.year, start.month
    while (y, m) <= (end.year, end.month):
        out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


async def get_settings_map(s: AsyncSession) -> dict:
    rows = (await s.execute(text("SELECT key, value FROM settings WHERE key LIKE 'kpi.%'"))).all()
    return {k: v for k, v in rows}


async def get_officer(s: AsyncSession, officer_id: uuid.UUID) -> Optional[Officer]:
    r = (await s.execute(text(
        "SELECT id, role, work_mode, manager_id FROM users "
        "WHERE id = :i AND is_active = true AND is_deleted = false"
    ), {"i": officer_id})).first()
    return Officer(r.id, r.role, r.work_mode or "both", r.manager_id) if r else None


async def field_officers_under(s: AsyncSession, manager_id: uuid.UUID) -> list[uuid.UUID]:
    rows = (await s.execute(text(
        "SELECT id FROM users WHERE manager_id = :m AND is_active = true AND is_deleted = false "
        "AND role = 'field_officer' AND work_mode IN ('field', 'both')"
    ), {"m": manager_id})).all()
    return [r.id for r in rows]


async def rules_for(s: AsyncSession, start: date) -> dict:
    """Weights, levels and grades in force on the period's start date."""
    weights = (await s.execute(text("""
        SELECT i.code, i.mode, w.weight, w.cap_pct, w.effective_from
        FROM kpi_item i
        JOIN LATERAL (
            SELECT weight, cap_pct, effective_from FROM kpi_weight_set
            WHERE item_id = i.id AND effective_from <= :d
            ORDER BY effective_from DESC LIMIT 1
        ) w ON true
        WHERE i.active = true ORDER BY i.sort_order
    """), {"d": start})).all()
    levels = (await s.execute(text("""
        SELECT level, sales_min_pct, sales_rate, coll_min_pct, coll_rate,
               entry_min_sales_pct, level_gap, effective_from
        FROM incentive_rule_set
        WHERE effective_from = (SELECT max(effective_from) FROM incentive_rule_set WHERE effective_from <= :d)
        ORDER BY level
    """), {"d": start})).all()
    grades = (await s.execute(text("""
        SELECT grade, label, min_score FROM grade_band
        WHERE effective_from = (SELECT max(effective_from) FROM grade_band WHERE effective_from <= :d)
    """), {"d": start})).all()
    return {"weights": weights, "levels": levels, "grades": grades}


async def goals_for(s: AsyncSession, officer_id: uuid.UUID, start: date, end: date) -> dict[str, tuple[Decimal, Decimal]]:
    """code -> (sum of monthly goals, average of monthly goals) over the period."""
    months = months_in(start, end)
    rows = (await s.execute(text("""
        SELECT i.code, sum(g.value) AS total, avg(g.value) AS mean
        FROM goal g JOIN kpi_item i ON i.id = g.item_id
        WHERE g.officer_id = :o AND (g.year * 100 + g.month) = ANY(:ym)
        GROUP BY i.code
    """), {"o": officer_id, "ym": [y * 100 + m for y, m in months]})).all()
    return {r.code: (Decimal(r.total), Decimal(r.mean)) for r in rows}


async def sales_totals(s: AsyncSession, officer_id: uuid.UUID, start: date, end: date) -> Optional[tuple[int, int]]:
    """(sales paise, collection paise) for the period, or None when no
    figures have been entered - the screen then says "Waiting for sales figures"."""
    months = months_in(start, end)
    r = (await s.execute(text("""
        SELECT count(*) AS n, coalesce(sum(sales_amount_paise), 0) AS sales,
               coalesce(sum(collection_amount_paise), 0) AS coll
        FROM sales_figure WHERE officer_id = :o AND (year * 100 + month) = ANY(:ym)
    """), {"o": officer_id, "ym": [y * 100 + m for y, m in months]})).one()
    return (int(r.sales), int(r.coll)) if r.n else None


_VISIT_DAY = "(v.start_time AT TIME ZONE :tz)::date BETWEEN :s AND :e"


async def field_counts(s: AsyncSession, officer_id: uuid.UUID, start: date, end: date) -> dict:
    tz = get_settings().company_timezone
    p = {"o": officer_id, "s": start, "e": end, "tz": tz}
    r = (await s.execute(text(f"""
        SELECT count(DISTINCT v.farmer_id) AS farmers,
               count(DISTINCT lower(btrim(f.village))) AS villages
        FROM visits v LEFT JOIN farmers f ON f.id = v.farmer_id
        WHERE v.user_id = :o AND v.farmer_id IS NOT NULL AND {_VISIT_DAY}
    """), p)).one()
    demo = (await s.execute(text(f"""
        SELECT count(DISTINCT v.farmer_id) FROM visits v
        JOIN visit_trial_details d ON d.visit_id = v.id
        WHERE v.user_id = :o AND v.farmer_id IS NOT NULL AND d.demo_status = ANY(:st) AND {_VISIT_DAY}
    """), {**p, "st": list(AGREED_STAGES)})).scalar_one()
    cents = (await s.execute(text(f"""
        SELECT coalesce(sum(d.trial_plot_size_cents), 0) FROM visits v
        JOIN visit_trial_details d ON d.visit_id = v.id
        WHERE v.user_id = :o AND v.is_trial = true AND {_VISIT_DAY}
    """), p)).scalar_one()
    return {
        "farmers": int(r.farmers), "villages": int(r.villages), "demo": int(demo),
        "acres": Decimal(cents) / 100,   # the app stores land in cents
    }


async def trial_to_paid(s: AsyncSession, officer_id: uuid.UUID, start: date, end: date, window_days: int) -> dict:
    """Farmers given a trial in the period, and how many bought within the
    window. A trial still inside its window with no purchase is 'waiting'."""
    tz = get_settings().company_timezone
    rows = (await s.execute(text(f"""
        WITH trials AS (
            SELECT v.farmer_id, min(v.start_time) AS trial_at
            FROM visits v
            WHERE v.user_id = :o AND v.is_trial = true AND v.farmer_id IS NOT NULL AND {_VISIT_DAY}
            GROUP BY v.farmer_id
        )
        SELECT t.farmer_id, t.trial_at,
               EXISTS (
                   SELECT 1 FROM visits v2
                   LEFT JOIN visit_sales vs ON vs.visit_id = v2.id
                   LEFT JOIN visit_trial_details d2 ON d2.visit_id = v2.id
                   WHERE v2.farmer_id = t.farmer_id
                     AND v2.start_time >= t.trial_at
                     AND v2.start_time <= t.trial_at + make_interval(days => :w)
                     AND (vs.purchased = true OR d2.demo_status = 'converted')
               ) AS paid
        FROM trials t
    """), {"o": officer_id, "s": start, "e": end, "tz": tz, "w": window_days})).all()
    now = datetime.now(tz=rows[0].trial_at.tzinfo) if rows else None
    total = len(rows)
    paid = sum(1 for r in rows if r.paid)
    waiting = sum(1 for r in rows if not r.paid and now and r.trial_at + timedelta(days=window_days) > now)
    return {"trials": total, "paid": paid, "waiting": waiting}


async def focus_products(s: AsyncSession, officer_id: uuid.UUID, period_id: uuid.UUID, start: date, end: date) -> dict:
    """Expected (plan) vs actual (orders) for the officer's focus products."""
    tz = get_settings().company_timezone
    rows = (await s.execute(text("""
        SELECT p.product_id, p.expected, p.unit,
               coalesce((
                   SELECT sum(CASE WHEN p.unit = 'units' THEN oi.quantity ELSE oi.quantity * oi.unit_price END)
                   FROM dealer_orders o JOIN order_items oi ON oi.order_id = o.id
                   WHERE o.created_by = :o AND oi.product_id = p.product_id
                     AND o.status <> ALL(:bad)
                     AND (o.order_date AT TIME ZONE :tz)::date BETWEEN :s AND :e
               ), 0) AS actual
        FROM focus_product_plan p WHERE p.period_id = :pid AND p.officer_id = :o
    """), {"o": officer_id, "pid": period_id, "s": start, "e": end, "tz": tz, "bad": list(NOT_AN_ORDER)})).all()
    expected = sum((Decimal(r.expected) for r in rows), Decimal(0))
    actual = sum((Decimal(r.actual) for r in rows), Decimal(0))
    done = sum(1 for r in rows if Decimal(r.actual) >= Decimal(r.expected))
    return {"planned": len(rows), "done": done, "expected": expected, "actual": actual}


async def active_dealers(s: AsyncSession, officer_id: uuid.UUID, start: date, end: date, min_orders: int) -> int:
    tz = get_settings().company_timezone
    r = (await s.execute(text("""
        SELECT count(*) FROM (
            SELECT o.dealer_id FROM dealer_orders o
            WHERE o.created_by = :o AND o.status <> ALL(:bad)
              AND (o.order_date AT TIME ZONE :tz)::date BETWEEN :s AND :e
            GROUP BY o.dealer_id HAVING count(*) >= :n
        ) x
    """), {"o": officer_id, "s": start, "e": end, "tz": tz, "n": min_orders, "bad": list(NOT_AN_ORDER)})).scalar_one()
    return int(r)


async def daily_report_ratio(s: AsyncSession, officer_id: uuid.UUID, start: date, end: date, today: date) -> dict:
    """Day closures sent the same day / working days so far.

    Working days: not a Sunday, not a company holiday, not a day of approved
    leave. Today only counts once the closure is in, so an officer is never
    marked down for a day that is still running."""
    tz = get_settings().company_timezone
    last = min(end, today)
    if last < start:
        return {"working_days": 0, "on_time": 0}
    holidays = {r.date for r in (await s.execute(text(
        "SELECT date FROM holiday_calendar WHERE date BETWEEN :s AND :e"), {"s": start, "e": last})).all()}
    leave_days: set[date] = set()
    for r in (await s.execute(text(
        "SELECT start_date, end_date FROM leave_requests WHERE officer_id = :o AND status = 'approved' "
        "AND is_deleted = false AND start_date <= :e AND end_date >= :s"), {"o": officer_id, "s": start, "e": last})).all():
        d = max(r.start_date, start)
        while d <= min(r.end_date, last):
            leave_days.add(d)
            d += timedelta(days=1)
    on_time = {r.date for r in (await s.execute(text("""
        SELECT date FROM day_closures
        WHERE officer_id = :o AND is_deleted = false AND date BETWEEN :s AND :e
          AND (created_at AT TIME ZONE :tz)::date = date
    """), {"o": officer_id, "s": start, "e": last, "tz": tz})).all()}
    working = 0
    hit = 0
    d = start
    while d <= last:
        if is_weekly_working_day(d) and d not in holidays and d not in leave_days:
            if d < today or d in on_time:
                working += 1
                hit += 1 if d in on_time else 0
        d += timedelta(days=1)
    return {"working_days": working, "on_time": hit}
