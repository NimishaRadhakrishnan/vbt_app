"""Targets/KPI/Incentive module, phase 2: the engine, the queue and who may read what.

Builds its own officers so it runs on any database, and removes them after.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.application.use_cases.kpi_recalculate import ensure_period, recalculate
from app.infrastructure.cache import kpi_queue
from app.infrastructure.cache.redis_client import get_redis_client
from app.infrastructure.config.settings import get_settings
from app.infrastructure.database.session import AsyncSessionLocal, engine
from app.infrastructure.repositories import kpi_data_repository as repo
from app.infrastructure.security.jwt_token_service import JWTTokenService
from app.main import app

TODAY = date(2026, 10, 15)          # inside the Oct-Dec 2026 quarter
RUPEE = 100
PAISE_GOAL = 1_015_205 * RUPEE


@pytest.fixture
async def db():
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:
        pytest.skip("No database reachable")
    created: list[uuid.UUID] = []
    async with AsyncSessionLocal() as s:
        s.created = created  # type: ignore[attr-defined]
        yield s
        await s.rollback()
    async with AsyncSessionLocal() as s:
        if created:
            await s.execute(text("DELETE FROM visits WHERE user_id = ANY(:ids)"), {"ids": created})
            await s.execute(text("DELETE FROM leave_requests WHERE officer_id = ANY(:ids)"), {"ids": created})
            await s.execute(text("DELETE FROM farmers WHERE crop = 'kpi-test'"))
            await s.execute(text("DELETE FROM users WHERE id = ANY(:ids)"), {"ids": created})
        await s.execute(text("DELETE FROM kpi_period WHERE start_date IN (:a, :b, :c)"),
                        {"a": date(2026, 10, 1), "b": date(2027, 1, 1), "c": date(2027, 2, 1)})
        await s.execute(text("DELETE FROM incentive_rule_set WHERE effective_from = :d"), {"d": date(2026, 12, 1)})
        await s.commit()


async def make_user(s, role="field_officer", work_mode="both", manager_id=None) -> uuid.UUID:
    uid = uuid.uuid4()
    await s.execute(text("""
        INSERT INTO users (id, email, hashed_password, full_name, role, is_active, work_mode, manager_id)
        VALUES (:i, :e, 'x', :n, :r, true, :w, :m)
    """), {"i": uid, "e": f"{uid}@kpi.test", "n": "KPI Test", "r": role, "w": work_mode, "m": manager_id})
    s.created.append(uid)
    await s.commit()
    return uid


async def set_goal(s, officer, code, year, month, value):
    await s.execute(text("""
        INSERT INTO goal (officer_id, item_id, year, month, value)
        SELECT :o, id, :y, :m, :v FROM kpi_item WHERE code = :c
        ON CONFLICT (officer_id, item_id, year, month) DO UPDATE SET value = EXCLUDED.value
    """), {"o": officer, "c": code, "y": year, "m": month, "v": value})


async def quarter(s):
    p = await ensure_period(s, "quarter", TODAY)
    await s.commit()
    return p


def token_for(uid, role):
    return JWTTokenService(get_settings(), get_redis_client())._create_access_token(uid, role)[0]


# ------------------------------------------------------------------ sales

async def test_sales_officer_incentive_and_level_match(db):
    s = db
    so = await make_user(s, work_mode="sales")
    q = await quarter(s)
    await set_goal(s, so, "sales_done", 2026, 10, PAISE_GOAL)
    await s.execute(text("""INSERT INTO sales_figure (officer_id, year, month, sales_amount_paise, collection_amount_paise)
        VALUES (:o, 2026, 10, :s, :c)"""), {"o": so, "s": PAISE_GOAL, "c": 600_000 * RUPEE})
    await s.commit()
    res = await recalculate(s, so, q["id"], today=TODAY)
    await s.commit()
    inc = res["sales"]["incentive"]
    assert (inc["raw_sales_level"], inc["raw_collection_level"]) == (2, 0)
    assert (inc["sales_level"], inc["collection_level"], inc["level_match_applied"]) == (1, 0, True)
    row = (await s.execute(text("SELECT sales_level, collection_level, level_match_applied, final_incentive_paise, "
                                "waiting_for_figures FROM performance_snapshot WHERE officer_id = :o"), {"o": so})).one()
    assert (row.sales_level, row.collection_level, row.level_match_applied) == (1, 0, True)
    assert row.final_incentive_paise % RUPEE == 0 and not row.waiting_for_figures
    assert res["sales"]["what_if"]["next_collection_level"] == 1


async def test_missing_figures_say_waiting_not_zero(db):
    s = db
    so = await make_user(s, work_mode="sales")
    q = await quarter(s)
    await set_goal(s, so, "sales_done", 2026, 10, PAISE_GOAL)
    await s.commit()
    res = await recalculate(s, so, q["id"], today=TODAY)
    await s.commit()
    assert res["sales"]["waiting_for_figures"] is True and "incentive" not in res["sales"]
    row = (await s.execute(text("SELECT waiting_for_figures, final_incentive_paise FROM performance_snapshot "
                                "WHERE officer_id = :o"), {"o": so})).one()
    assert row.waiting_for_figures and row.final_incentive_paise is None


async def test_closed_quarter_is_never_recalculated(db):
    s = db
    so = await make_user(s, work_mode="sales")
    q = await quarter(s)
    await s.execute(text("UPDATE kpi_period SET status = 'closed' WHERE id = :i"), {"i": q["id"]})
    await s.commit()
    assert await recalculate(s, so, q["id"], today=TODAY) is None
    assert (await s.execute(text("SELECT count(*) FROM performance_snapshot WHERE officer_id = :o"), {"o": so})).scalar_one() == 0


async def test_rule_change_leaves_old_quarters_unchanged(db):
    s = db
    await s.execute(text("""INSERT INTO incentive_rule_set (level, sales_min_pct, sales_rate, coll_min_pct, coll_rate, effective_from)
        VALUES (1, 0.8, 0.0100, 0.85, 0.0200, DATE '2026-12-01')"""))
    await s.commit()
    old = await repo.rules_for(s, date(2026, 10, 1))      # quarter that started before the change
    new = await repo.rules_for(s, date(2027, 1, 1))       # quarter that starts after it
    assert [(r.level, r.sales_rate) for r in old["levels"]] == [(1, Decimal("0.0015")), (2, Decimal("0.0025")), (3, Decimal("0.0050"))]
    assert [(r.level, r.sales_rate) for r in new["levels"]] == [(1, Decimal("0.0100"))]


# ------------------------------------------------------------------ field

async def add_visit(s, officer, farmer, when, trial=False, stage=None, cents=None, purchased=False):
    vid = uuid.uuid4()
    await s.execute(text("""INSERT INTO visits (id, user_id, visit_type, farmer_id, start_time, location_start, is_trial)
        VALUES (:i, :u, 'farmer', :f, :t, ST_GeogFromText('POINT(77 11)'), :tr)"""),
                    {"i": vid, "u": officer, "f": farmer, "t": when, "tr": trial})
    if stage or cents:
        await s.execute(text("INSERT INTO visit_trial_details (visit_id, demo_status, trial_plot_size_cents) VALUES (:v, :d, :c)"),
                        {"v": vid, "d": stage, "c": cents})
    if purchased:
        await s.execute(text("INSERT INTO visit_sales (visit_id, purchased) VALUES (:v, true)"), {"v": vid})


async def add_farmer(s, village):
    fid = uuid.uuid4()
    await s.execute(text("""INSERT INTO farmers (id, name, phone, village, taluk, district, crop, cents)
        VALUES (:i, 'F', :p, :v, 't', 'd', 'kpi-test', 10)"""), {"i": fid, "p": str(fid)[:12], "v": village})
    return fid


async def test_field_counts_and_trial_to_paid(db):
    s = db
    fo = await make_user(s, work_mode="field")
    q = await quarter(s)
    a, b, c = await add_farmer(s, "Annur"), await add_farmer(s, "Annur"), await add_farmer(s, "Sulur")
    t = datetime(2026, 10, 5, 5, 0, tzinfo=timezone.utc)
    await add_visit(s, fo, a, t, trial=True, stage="agreed_not_started", cents=200)    # 2 acres
    await add_visit(s, fo, b, t, trial=True, stage="started_today", cents=100)         # 1 acre
    await add_visit(s, fo, c, t)                                                       # visit only
    await add_visit(s, fo, a, t + timedelta(days=20), purchased=True)                  # a bought within 60 days
    for code, v in (("farmers_visited", 3), ("villages_covered", 2), ("demo_agreed", 2), ("trial_area", 3)):
        await set_goal(s, fo, code, 2026, 10, v)
    await set_goal(s, fo, "trial_to_paid", 2026, 10, Decimal("0.5"))
    await s.commit()
    res = await recalculate(s, fo, q["id"], today=TODAY)
    await s.commit()
    items = res["field"]["items"]
    assert items["farmers_visited"]["done"] == 3
    assert items["villages_covered"]["done"] == 2           # Annur counted once
    assert items["demo_agreed"]["done"] == 2
    assert items["trial_area"]["done"] == 3.0               # cents -> acres
    assert items["trial_to_paid"]["done"] == 0.5            # 1 of 2 trials paid
    assert res["field"]["score"] == pytest.approx(100.0)    # every item exactly at goal
    f = res["field"]["trial_funnel"]
    assert (f["trials"], f["paid"]) == (2, 1)


async def test_field_officer_with_no_visits_scores_zero(db):
    s = db
    fo = await make_user(s, work_mode="field")
    q = await quarter(s)
    await set_goal(s, fo, "farmers_visited", 2026, 10, 30)
    await s.commit()
    res = await recalculate(s, fo, q["id"], today=TODAY)
    assert res["field"]["score"] == 0


async def test_fo_follow_up_uses_officers_who_report_to_you(db):
    s = db
    boss = await make_user(s, work_mode="sales")
    fo = await make_user(s, work_mode="field", manager_id=boss)
    q = await quarter(s)
    a = await add_farmer(s, "Annur")
    await add_visit(s, fo, a, datetime(2026, 10, 5, 5, 0, tzinfo=timezone.utc))
    await set_goal(s, fo, "farmers_visited", 2026, 10, 1)
    await set_goal(s, boss, "sales_done", 2026, 10, PAISE_GOAL)
    await s.commit()
    res = await recalculate(s, boss, q["id"], today=TODAY)
    fu = res["sales"]["items"]["fo_follow_up"]
    assert fu["done"] == pytest.approx(100.0) and not fu["skipped"]    # the FO's field score


async def test_leave_all_month_means_no_working_days(db):
    s = db
    fo = await make_user(s, work_mode="sales")
    await s.execute(text("""INSERT INTO leave_requests (officer_id, leave_type, start_date, end_date, reason, status)
        VALUES (:o, 'planned', DATE '2026-10-01', DATE '2026-10-31', 'x', 'approved')"""), {"o": fo})
    await s.commit()
    r = await repo.daily_report_ratio(s, fo, date(2026, 10, 1), date(2026, 10, 31), date(2026, 10, 31))
    assert r == {"working_days": 0, "on_time": 0}          # nothing to mark down


# ------------------------------------------------------------------ queue

async def test_queue_recalculates_a_queued_officer(db):
    s = db
    fo = await make_user(s, work_mode="field")
    await get_redis_client().delete(kpi_queue.QUEUE_KEY)
    await kpi_queue.enqueue_officer(fo, TODAY)
    await kpi_queue.enqueue_officer(fo, TODAY)             # the same officer twice is one job
    assert await get_redis_client().scard(kpi_queue.QUEUE_KEY) == 1
    assert await kpi_queue.drain_once() == 1
    n = (await s.execute(text("SELECT count(*) FROM performance_snapshot WHERE officer_id = :o"), {"o": fo})).scalar_one()
    assert n == 2                                          # month + quarter


# ------------------------------------------------------------- who may read

async def test_visibility_rules(db):
    s = db
    admin = await make_user(s, role="admin")
    mgr = await make_user(s, role="manager")
    mine = await make_user(s, work_mode="field", manager_id=mgr)
    other = await make_user(s, work_mode="field")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        def h(u, role):
            return {"Authorization": f"Bearer {token_for(u, role)}"}
        # own numbers
        assert (await c.get("/api/v1/kpi/me", headers=h(mine, "field_officer"))).status_code == 200
        # another officer's numbers: refused for an officer, even with a valid id
        assert (await c.get(f"/api/v1/kpi/officers/{other}", headers=h(mine, "field_officer"))).status_code == 403
        # a manager sees their own team only
        assert (await c.get(f"/api/v1/kpi/officers/{mine}", headers=h(mgr, "manager"))).status_code == 200
        assert (await c.get(f"/api/v1/kpi/officers/{other}", headers=h(mgr, "manager"))).status_code == 403
        # admin sees everyone
        assert (await c.get(f"/api/v1/kpi/officers/{other}", headers=h(admin, "admin"))).status_code == 200
        # no token
        assert (await c.get(f"/api/v1/kpi/officers/{other}")).status_code == 401
