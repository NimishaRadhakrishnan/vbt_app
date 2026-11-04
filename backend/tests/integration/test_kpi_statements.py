"""Phase 5: close / reopen, approve, paid, breakdown, exports, team overview, who may see what."""
from __future__ import annotations

from datetime import date

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.application.use_cases import kpi_statements as stm
from app.main import app
from tests.integration.test_kpi_engine import RUPEE, PAISE_GOAL, db, make_user, set_goal, token_for  # noqa: F401

pytestmark = pytest.mark.asyncio
Q_START = date(2026, 7, 1)     # Jul-Sep 2026, already finished


@pytest.fixture
async def clean(db):
    yield db
    s = db
    await s.rollback()
    ids = list(s.created)
    await s.execute(text("DELETE FROM incentive_statement WHERE officer_id = ANY(:i)"), {"i": ids})
    await s.execute(text("DELETE FROM incentive_statement WHERE period_id IN (SELECT id FROM kpi_period WHERE start_date IN "
                         "(DATE '2026-07-01', DATE '2026-08-01', DATE '2026-09-01'))"))
    await s.execute(text("DELETE FROM kpi_period WHERE start_date IN (DATE '2026-07-01', DATE '2026-08-01', DATE '2026-09-01')"))
    await s.commit()


def client(uid, role):
    c = AsyncClient(transport=ASGITransport(app=app), base_url="http://t")
    c.headers["Authorization"] = f"Bearer {token_for(uid, role)}"
    return c


async def _setup(s):
    admin = await make_user(s, role="admin")
    mgr = await make_user(s, role="manager")
    so = await make_user(s, work_mode="sales", manager_id=mgr)
    other = await make_user(s, work_mode="sales")
    for o in (so, other):
        await set_goal(s, o, "sales_done", 2026, 7, PAISE_GOAL)
        await s.execute(text("""INSERT INTO sales_figure (officer_id, year, month, sales_amount_paise, collection_amount_paise)
            VALUES (:o, 2026, 7, :s, :c)"""), {"o": o, "s": PAISE_GOAL, "c": 700_000 * RUPEE})
    await s.commit()
    from app.application.use_cases.kpi_recalculate import ensure_period
    q = await ensure_period(s, "quarter", Q_START)
    await s.commit()
    return admin, mgr, so, other, str(q["id"])


async def test_full_lifecycle(clean):
    s = clean
    admin, mgr, so, other, pid = await _setup(s)
    async with client(admin, "admin") as a:
        lst = (await a.get(f"/api/v1/kpi/statements?period_id={pid}")).json()
        mine = next(r for r in lst["rows"] if r["officer_id"] == str(so))
        assert mine["status"] == "draft" and not lst["period"]["closed"]

        assert (await a.post("/api/v1/kpi/statements/approve-all", json={"period_id": pid})).status_code == 400   # not closed yet
        r = await a.post("/api/v1/kpi/statements/close", json={"period_id": pid})
        assert r.status_code == 200, r.text
        assert (await a.post("/api/v1/kpi/statements/close", json={"period_id": pid})).status_code == 400          # already closed

        lst = (await a.get(f"/api/v1/kpi/statements?period_id={pid}")).json()
        mine = next(r for r in lst["rows"] if r["officer_id"] == str(so))
        assert lst["period"]["closed"] and mine["statement_id"] and mine["final_paise"] % RUPEE == 0 and mine["final_paise"] > 0
        sid = mine["statement_id"]

        # frozen: later changes to the figures do not move the statement
        await s.execute(text("UPDATE sales_figure SET sales_amount_paise = 1 WHERE officer_id = :o"), {"o": so})
        await s.commit()
        d = (await a.get(f"/api/v1/kpi/statements/officer/{so}?period_id={pid}")).json()
        assert d["frozen"] and d["final_paise"] == mine["final_paise"]
        titles = [x["title"] for x in d["sections"]]
        assert any("Level match" in t for t in titles) and any("Sales score" in t for t in titles)
        assert d["sections"][-1]["rows"][-1][1] == stm.inr(mine["final_paise"])

        assert (await a.post(f"/api/v1/kpi/statements/{sid}/paid", json={"paid_on": "2026-10-20"})).status_code == 400  # not approved
        assert (await a.post(f"/api/v1/kpi/statements/approve-all", json={"period_id": pid})).json()["approved"] >= 2
        assert (await a.post(f"/api/v1/kpi/statements/{sid}/paid", json={"paid_on": "2099-01-01"})).status_code == 400   # future date
        assert (await a.post(f"/api/v1/kpi/statements/{sid}/paid", json={"paid_on": "2026-10-20"})).status_code == 200

        x = await a.get(f"/api/v1/kpi/statements/export.xlsx?period_id={pid}")
        assert x.status_code == 200 and x.content[:2] == b"PK"
        from openpyxl import load_workbook
        import io
        wb = load_workbook(io.BytesIO(x.content))
        assert wb["Summary"]["H4"].value is not None and len(wb.sheetnames) >= 3
        p = await a.get(f"/api/v1/kpi/statements/export.pdf?period_id={pid}")
        assert p.status_code == 200 and p.content[:4] == b"%PDF"

        # a paid quarter cannot be reopened
        assert (await a.post("/api/v1/kpi/statements/reopen", json={"period_id": pid, "reason": "fix"})).status_code == 400

    # who may see what
    async with client(so, "field_officer") as o:
        own = await o.get(f"/api/v1/kpi/me/statement?period_id={pid}")
        assert own.status_code == 200 and own.json()["status"] == "paid"
        assert (await o.get(f"/api/v1/kpi/statements?period_id={pid}")).status_code in (401, 403)
        assert (await o.post("/api/v1/kpi/statements/close", json={"period_id": pid})).status_code in (401, 403)
    async with client(mgr, "manager") as m:
        ids = {r["officer_id"] for r in (await m.get(f"/api/v1/kpi/statements?period_id={pid}")).json()["rows"]}
        assert ids == {str(so)}                                                    # own team only
        assert (await m.get(f"/api/v1/kpi/statements/officer/{other}?period_id={pid}")).status_code == 403
        assert (await m.post("/api/v1/kpi/statements/approve-all", json={"period_id": pid})).status_code in (401, 403)


async def test_reopen_and_missing_figures(clean):
    s = clean
    admin, mgr, so, other, pid = await _setup(s)
    nofig = await make_user(s, work_mode="sales")
    await set_goal(s, nofig, "sales_done", 2026, 7, PAISE_GOAL)
    await s.commit()
    async with client(admin, "admin") as a:
        r = await a.post("/api/v1/kpi/statements/close", json={"period_id": pid})
        assert r.status_code == 400 and "missing" in r.text.lower()
        assert (await a.post("/api/v1/kpi/statements/close", json={"period_id": pid, "allow_missing": True})).status_code == 200
        amount = next(x for x in (await a.get(f"/api/v1/kpi/statements?period_id={pid}")).json()["rows"] if x["officer_id"] == str(nofig))
        assert amount["final_paise"] == 0
        assert (await a.post("/api/v1/kpi/statements/reopen", json={"period_id": pid, "reason": " "})).status_code == 400
        assert (await a.post("/api/v1/kpi/statements/reopen", json={"period_id": pid, "reason": "figures corrected"})).status_code == 200
        lst = (await a.get(f"/api/v1/kpi/statements?period_id={pid}")).json()
        assert not lst["period"]["closed"] and all(r["statement_id"] is None for r in lst["rows"])
        log = (await s.execute(text("SELECT reason FROM kpi_audit_log WHERE entity = 'statement' AND action = 'reopen'"))).first()
        assert log and log.reason == "figures corrected"


async def test_team_overview(clean):
    s = clean
    admin, mgr, so, other, pid = await _setup(s)
    import uuid as _u
    from app.application.use_cases.kpi_recalculate import recalculate
    for o in (so, other):
        await recalculate(s, o, _u.UUID(pid), today=date(2026, 10, 15))
    await s.commit()
    async with client(admin, "admin") as a:
        j = (await a.get(f"/api/v1/kpi/team-overview?kind=quarter&period_id={pid}")).json()
        names = {h["officer_id"] for h in j["heat"]}
        assert {str(so), str(other)} <= names
        assert j["totals"]["sales_goal_paise"] >= 2 * PAISE_GOAL and len(j["level_spread"]) == 4 and len(j["trend"]) == 3
        h = next(h for h in j["heat"] if h["officer_id"] == str(so))
        assert abs(h["cells"]["sales_done"] - 1.0) < 1e-6
    async with client(mgr, "manager") as m:
        j = (await m.get(f"/api/v1/kpi/team-overview?kind=quarter&period_id={pid}")).json()
        assert {h["officer_id"] for h in j["heat"]} == {str(so)}
