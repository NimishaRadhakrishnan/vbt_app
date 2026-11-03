"""Targets/KPI/Incentive module, phase 1: tables and seed data.

Checks the migration produced what the brief's Excel sheets define, so the
phase 2 engine can rely on it: the 11 goal items, marks that add up, the
three incentive levels with their rates, grade bands and admin settings.
"""
from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_eleven_goal_items(db_session):
    rows = (await db_session.execute(text("SELECT mode, count(*) FROM kpi_item GROUP BY mode"))).all()
    assert dict(rows) == {"field": 5, "sales": 6}


@pytest.mark.asyncio
async def test_marks_add_up_to_100_per_mode(db_session):
    rows = (await db_session.execute(text("""
        SELECT i.mode, sum(w.weight), min(w.cap_pct), max(w.cap_pct)
        FROM kpi_weight_set w JOIN kpi_item i ON i.id = w.item_id GROUP BY i.mode
    """))).all()
    by_mode = {r[0]: r for r in rows}
    assert by_mode["field"][1] == Decimal("100")
    assert by_mode["sales"][1] == Decimal("100")
    assert by_mode["sales"][2] == by_mode["sales"][3] == Decimal("1.2")


@pytest.mark.asyncio
async def test_sales_marks_match_the_scorecard(db_session):
    rows = (await db_session.execute(text("""
        SELECT i.code, w.weight FROM kpi_weight_set w JOIN kpi_item i ON i.id = w.item_id
        WHERE i.mode = 'sales'
    """))).all()
    assert {c: int(w) for c, w in rows} == {
        "sales_done": 30, "focus_products": 15, "money_collected": 20,
        "dealer_health": 10, "fo_follow_up": 15, "daily_report": 10,
    }


@pytest.mark.asyncio
async def test_incentive_levels_match_the_calculator_sheet(db_session):
    rows = (await db_session.execute(text(
        "SELECT level, sales_min_pct, sales_rate, coll_min_pct, coll_rate, entry_min_sales_pct, level_gap "
        "FROM incentive_rule_set ORDER BY level"
    ))).all()
    d = Decimal
    assert [tuple(r) for r in rows] == [
        (1, d("0.8"), d("0.0015"), d("0.85"), d("0.0125"), d("0.8"), 2),
        (2, d("1.0"), d("0.0025"), d("1.1"), d("0.015"), d("0.8"), 2),
        (3, d("1.2"), d("0.005"), d("1.4"), d("0.0175"), d("0.8"), 2),
    ]


@pytest.mark.asyncio
async def test_grade_bands_and_settings_seeded(db_session):
    grades = (await db_session.execute(text("SELECT grade, min_score FROM grade_band ORDER BY min_score DESC"))).all()
    assert [(g, int(m)) for g, m in grades] == [("A", 90), ("B", 75), ("C", 60), ("D", 0)]
    window = (await db_session.execute(text("SELECT value FROM settings WHERE key = 'kpi.conversion_window_days'"))).scalar_one()
    assert window == 60

