"""Phase 4: the officer's Dashboard card / My Goals read side."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.infrastructure.config.company_time import company_today
from app.main import app
from tests.integration.test_kpi_engine import RUPEE, db, make_user, set_goal, token_for  # noqa: F401

pytestmark = pytest.mark.asyncio


async def _client(uid, role="field_officer"):
    c = AsyncClient(transport=ASGITransport(app=app), base_url="http://t")
    c.headers["Authorization"] = f"Bearer {token_for(uid, role)}"
    return c


async def _cleanup(s):
    t = company_today()
    await s.execute(text("DELETE FROM kpi_period WHERE start_date <= :t AND end_date >= :t"), {"t": t})
    await s.commit()


async def test_overview_sales_officer(db):
    s, t = db, company_today()
    so = await make_user(s, work_mode="sales")
    await set_goal(s, so, "sales_done", t.year, t.month, 1_000_000 * RUPEE)
    await s.execute(text("""INSERT INTO sales_figure (officer_id, year, month, sales_amount_paise, collection_amount_paise)
        VALUES (:o, :y, :m, :s, :c)"""), {"o": so, "y": t.year, "m": t.month, "s": 900_000 * RUPEE, "c": 500_000 * RUPEE})
    await s.commit()
    async with await _client(so) as c:
        r = await c.get("/api/v1/kpi/me/overview?period=month")
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["mode"] == "sales" and "field" not in j and j["sales"]["incentive"]["earned_so_far_paise"] % RUPEE == 0
        assert len(j["sales"]["ladder"]["rows"]) == 3
        assert j["advice"]
        assert "₹1,00,000" in j["advice"]
        for path in ("calendar", "best", "past?period=month", "series?item=sales_done"):
            assert (await c.get(f"/api/v1/kpi/me/{path}")).status_code in (200, 400)
        assert (await c.get("/api/v1/kpi/me/series?item=farmers_visited")).status_code == 200
        for item in ("farmers_visited", "villages_covered", "demo_agreed", "trial_area", "trial_to_paid",
                     "dealer_health", "daily_report", "sales_done", "money_collected", "focus_products"):
            assert (await c.get(f"/api/v1/kpi/me/entries?item={item}")).status_code == 200, item
    await _cleanup(s)


async def test_overview_only_for_field_officers(db):
    s = db
    mgr = await make_user(s, role="manager")
    async with await _client(mgr, "manager") as c:
        assert (await c.get("/api/v1/kpi/me/overview")).status_code == 403
        assert (await c.get("/api/v1/kpi/me/entries?item=farmers_visited")).status_code == 403
