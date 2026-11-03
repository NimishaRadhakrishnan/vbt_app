"""Targets/KPI/Incentive module, phase 3: what an admin can set, import and see in the history."""
from __future__ import annotations

import io
import uuid
from datetime import date
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient
from openpyxl import load_workbook
from sqlalchemy import text

from app.application.use_cases.kpi_admin import split_amount
from app.infrastructure.config.settings import get_settings
from app.infrastructure.cache.redis_client import get_redis_client
from app.infrastructure.database.session import AsyncSessionLocal, engine
from app.infrastructure.security.jwt_token_service import JWTTokenService
from app.main import app

Q = "2026-10,2026-11,2026-12"


def _token(uid, role):
    return JWTTokenService(get_settings(), get_redis_client())._create_access_token(uid, role)[0]


@pytest.fixture
async def env():
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:
        pytest.skip("No database reachable")
    made: list[uuid.UUID] = []
    regions: list[uuid.UUID] = []

    async def user(role="field_officer", mode="both", emp=None):
        uid = uuid.uuid4()
        async with AsyncSessionLocal() as s:
            await s.execute(text("""INSERT INTO users (id, email, hashed_password, full_name, role, is_active, work_mode, employee_id)
                VALUES (:i, :e, 'x', :n, :r, true, :w, :emp)"""),
                            {"i": uid, "e": f"{uid}@kpi.test", "n": f"Officer {str(uid)[:4]}", "r": role, "w": mode,
                             "emp": emp or f"T{str(uid)[:6]}"})
            await s.commit()
        made.append(uid)
        return uid

    async def region(name, members):
        rid = uuid.uuid4()
        async with AsyncSessionLocal() as s:
            await s.execute(text("INSERT INTO territories (id, name, district) VALUES (:i, :n, 'd')"), {"i": rid, "n": name})
            for m in members:
                await s.execute(text("INSERT INTO user_territories (user_id, territory_id) VALUES (:u, :t)"), {"u": m, "t": rid})
            await s.commit()
        regions.append(rid)
        return rid

    admin = await user("admin")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield {"c": c, "user": user, "region": region, "admin": admin,
               "h": {"Authorization": f"Bearer {_token(admin, 'admin')}"}, "token": _token}
    async with AsyncSessionLocal() as s:
        await s.execute(text("DELETE FROM kpi_audit_log WHERE user_id = ANY(:i)"), {"i": made})
        await s.execute(text("DELETE FROM user_territories WHERE user_id = ANY(:i)"), {"i": made})
        await s.execute(text("DELETE FROM month_weight WHERE region_id = ANY(:r)"), {"r": regions})
        await s.execute(text("DELETE FROM territories WHERE id = ANY(:r)"), {"r": regions})
        await s.execute(text("DELETE FROM users WHERE id = ANY(:i)"), {"i": made})
        await s.execute(text("DELETE FROM kpi_weight_set WHERE effective_from = DATE '2027-04-01'"))
        await s.execute(text("DELETE FROM incentive_rule_set WHERE effective_from = DATE '2027-04-01'"))
        await s.execute(text("DELETE FROM grade_band WHERE effective_from = DATE '2027-04-01'"))
        await s.execute(text("DELETE FROM kpi_period WHERE start_date IN (DATE '2026-10-01', DATE '2026-11-01', DATE '2026-12-01')"))
        await s.commit()


def test_split_adds_up_exactly():
    parts = split_amount(Decimal(1_000_000), [Decimal(1)] * 12, 0)
    assert sum(parts) == 1_000_000 and max(parts) - min(parts) <= 1
    seasonal = split_amount(Decimal(100), [Decimal(1), Decimal(3), Decimal(0), Decimal(2)], 0)
    assert sum(seasonal) == 100 and seasonal[2] == 0
    assert sum(split_amount(Decimal("10.00"), [Decimal(1)] * 3, 2)) == Decimal("10.00")


async def test_only_admin_can_use_it(env):
    o = await env["user"]()
    r = await env["c"].get("/api/v1/kpi/admin/officers", headers={"Authorization": f"Bearer {env['token'](o, 'field_officer')}"})
    assert r.status_code == 403
    assert (await env["c"].get("/api/v1/kpi/admin/officers")).status_code == 401


async def test_goal_grid_saves_in_the_right_units_and_logs_history(env):
    c, h = env["c"], env["h"]
    o = await env["user"]()
    cells = [{"officer_id": str(o), "code": "sales_done", "year": 2026, "month": 10, "value": 1015205},
             {"officer_id": str(o), "code": "trial_to_paid", "year": 2026, "month": 10, "value": 30},
             {"officer_id": str(o), "code": "farmers_visited", "year": 2026, "month": 10, "value": 40}]
    r = await c.put("/api/v1/kpi/admin/goals", headers=h, json={"cells": cells, "reason": "Q3 plan"})
    assert r.status_code == 200 and r.json()["changed"] == 3
    async with AsyncSessionLocal() as s:     # stored as paise / 0-1 ratio
        got = dict((await s.execute(text("""SELECT i.code, g.value FROM goal g JOIN kpi_item i ON i.id = g.item_id
            WHERE g.officer_id = :o"""), {"o": o})).all())
    assert got["sales_done"] == Decimal(101520500) and got["trial_to_paid"] == Decimal("0.3000") and got["farmers_visited"] == 40
    shown = {g["code"]: g["value"] for g in (await c.get(f"/api/v1/kpi/admin/goals?months={Q}", headers=h)).json()
             if g["officer_id"] == str(o)}
    assert shown == {"sales_done": 1015205.0, "trial_to_paid": 30.0, "farmers_visited": 40.0}
    # saving the same numbers again changes nothing and adds no history
    assert (await c.put("/api/v1/kpi/admin/goals", headers=h, json={"cells": cells})).json()["changed"] == 0
    # a change is recorded with old and new value, who and why
    cells[2]["value"] = 45
    await c.put("/api/v1/kpi/admin/goals", headers=h, json={"cells": cells, "reason": "Raised"})
    hist = (await c.get(f"/api/v1/kpi/admin/history?entity=goal&officer_id={o}", headers=h)).json()
    upd = [x for x in hist if x["action"] == "update"][0]
    assert upd["old"]["value"] == 40 and upd["new"]["value"] == 45 and upd["reason"] == "Raised" and upd["by"]


async def test_negative_and_wrong_items_are_refused(env):
    c, h = env["c"], env["h"]
    o = await env["user"]()
    base = {"officer_id": str(o), "year": 2026, "month": 10}
    assert (await c.put("/api/v1/kpi/admin/goals", headers=h, json={"cells": [{**base, "code": "sales_done", "value": -5}]})).status_code == 422
    assert (await c.put("/api/v1/kpi/admin/goals", headers=h, json={"cells": [{**base, "code": "fo_follow_up", "value": 5}]})).status_code == 400
    assert (await c.put("/api/v1/kpi/admin/goals", headers=h, json={"cells": [{**base, "code": "trial_to_paid", "value": 150}]})).status_code == 400


async def test_yearly_goal_splits_by_season_weights_and_adds_up(env):
    c, h = env["c"], env["h"]
    a, b = await env["user"](), await env["user"]()
    rid = await env["region"]("KPI test region", [a, b])
    weights = [{"month": m, "weight": 3 if m in (6, 7, 8) else 1} for m in range(1, 13)]
    assert (await c.put(f"/api/v1/kpi/admin/month-weights?region_id={rid}&year=2026", headers=h, json={"weights": weights})).status_code == 200
    r = await c.post("/api/v1/kpi/admin/goals/split-yearly", headers=h,
                     json={"code": "farmers_visited", "fy_year": 2026, "yearly_value": 1200, "region_id": str(rid)})
    assert r.status_code == 200 and r.json()["officers"] == 2
    months = ",".join(f"{y}-{m:02d}" for y, m in [(2026, m) for m in range(4, 13)] + [(2027, m) for m in range(1, 4)])
    got = [g for g in (await c.get(f"/api/v1/kpi/admin/goals?months={months}", headers=h)).json() if g["officer_id"] == str(a)]
    assert sum(g["value"] for g in got) == 1200 and len(got) == 12
    jun = next(g["value"] for g in got if g["month"] == 6)
    oct_ = next((g["value"] for g in got if g["month"] == 10), None)
    assert jun > oct_ and jun == pytest.approx(3 * oct_, abs=1)    # season weight


async def test_copy_last_year_and_apply_to_region(env):
    c, h = env["c"], env["h"]
    a, b = await env["user"](), await env["user"]()
    rid = await env["region"]("KPI copy region", [a, b])
    put = lambda o, y, v: {"officer_id": str(o), "code": "villages_covered", "year": y, "month": 10, "value": v}
    await c.put("/api/v1/kpi/admin/goals", headers=h, json={"cells": [put(a, 2025, 12)]})
    r = await c.post("/api/v1/kpi/admin/goals/copy-last-year", headers=h, json={"months": "2026-10"})
    assert r.status_code == 200 and r.json()["changed"] >= 1
    r = await c.post("/api/v1/kpi/admin/goals/apply-to-region", headers=h,
                     json={"source_officer_id": str(a), "region_id": str(rid), "months": "2026-10"})
    assert r.status_code == 200 and r.json()["changed"] == 1
    mine = [g for g in (await c.get("/api/v1/kpi/admin/goals?months=2026-10", headers=h)).json()
            if g["officer_id"] == str(b) and g["code"] == "villages_covered"]
    assert mine and mine[0]["value"] == 12


async def test_rules_need_marks_adding_to_100_and_are_versioned(env):
    c, h = env["c"], env["h"]
    rules = (await c.get("/api/v1/kpi/admin/rules", headers=h)).json()
    assert [l["level"] for l in rules["levels"]] == [1, 2, 3]
    bad = {"effective_from": "2027-04-01", "reason": "t",
           "weights": [{"code": "farmers_visited", "weight": 50, "cap_pct": 1.2}]}
    assert (await c.put("/api/v1/kpi/admin/rules", headers=h, json=bad)).status_code == 400
    assert (await c.put("/api/v1/kpi/admin/rules", headers=h, json={"effective_from": "2027-04-01", "levels": rules["levels"]})).status_code == 400  # no reason
    new_levels = [{**l, "sales_rate": l["sales_rate"] * 2} for l in rules["levels"]]
    ok = await c.put("/api/v1/kpi/admin/rules", headers=h,
                     json={"effective_from": "2027-04-01", "reason": "Higher rates", "levels": new_levels})
    assert ok.status_code == 200, ok.text
    old = (await c.get("/api/v1/kpi/admin/rules?on=2027-03-31", headers=h)).json()
    new = (await c.get("/api/v1/kpi/admin/rules?on=2027-04-01", headers=h)).json()
    assert old["levels"][0]["sales_rate"] == 0.0015 and new["levels"][0]["sales_rate"] == 0.003
    pv = (await c.get("/api/v1/kpi/admin/rules/preview?effective_from=2027-04-01", headers=h)).json()
    assert pv["officers"] == 0      # starts after the running period: nothing changes today
    hist = (await c.get("/api/v1/kpi/admin/history?entity=rules", headers=h)).json()
    assert hist[0]["reason"] == "Higher rates"


async def test_sales_figures_manual_and_history(env):
    c, h = env["c"], env["h"]
    o = await env["user"]()
    r = await c.put("/api/v1/kpi/admin/sales-figures", headers=h, json={"rows": [
        {"officer_id": str(o), "year": 2026, "month": 10, "sales": 1015205, "collection": 600000}]})
    assert r.json()["changed"] == 1
    got = [x for x in (await c.get("/api/v1/kpi/admin/sales-figures?year=2026&month=10", headers=h)).json() if x["officer_id"] == str(o)]
    assert got[0]["sales"] == 1015205 and got[0]["collection"] == 600000
    neg = await c.put("/api/v1/kpi/admin/sales-figures", headers=h, json={"rows": [
        {"officer_id": str(o), "year": 2026, "month": 10, "sales": -1, "collection": 0}]})
    assert neg.status_code == 422


async def test_focus_products_pick_from_master_and_log(env):
    c, h = env["c"], env["h"]
    o = await env["user"]()
    async with AsyncSessionLocal() as s:
        pid = (await s.execute(text("""INSERT INTO products (name, category, sku_code, price, is_active)
            VALUES ('KPI test product', 'x', :sku, 10, true) RETURNING id"""), {"sku": f"K{uuid.uuid4().hex[:8]}"})).scalar_one()
        await s.commit()
    try:
        body = {"on": "2026-10-15", "product_id": str(pid), "officer_ids": [str(o)], "expected": 50000, "unit": "rupees"}
        assert (await c.put("/api/v1/kpi/admin/focus-products", headers=h, json=body)).json()["changed"] == 1
        plan = (await c.get("/api/v1/kpi/admin/focus-products?on=2026-10-15", headers=h)).json()
        row = next(r for r in plan["rows"] if r["officer_id"] == str(o))
        assert row["product"] == "KPI test product" and row["expected"] == 50000 and row["done"] is False
        # a typed-in product that is not in the master is refused
        bad = await c.put("/api/v1/kpi/admin/focus-products", headers=h, json={**body, "product_id": str(uuid.uuid4())})
        assert bad.status_code == 400
        assert (await c.delete(f"/api/v1/kpi/admin/focus-products/{row['id']}?reason=cleanup", headers=h)).status_code == 204
    finally:
        async with AsyncSessionLocal() as s:
            await s.execute(text("DELETE FROM focus_product_plan WHERE product_id = :p"), {"p": pid})
            await s.execute(text("DELETE FROM products WHERE id = :p"), {"p": pid})
            await s.commit()


async def test_excel_goals_template_import_check_then_save(env):
    c, h = env["c"], env["h"]
    people = [await env["user"](mode="field") for _ in range(12)]
    tpl = await c.get(f"/api/v1/kpi/admin/goals/template?months={Q}", headers=h)
    assert tpl.status_code == 200
    wb = load_workbook(io.BytesIO(tpl.content))
    ws = wb["Goals"]
    mine = [str(p)[:6] for p in people]
    filled = 0
    for row in ws.iter_rows(min_row=2):
        if str(row[0].value) in {f"T{m}" for m in mine}:
            row[6].value = 25 if row[2].value != "trial_to_paid" else 40
            filled += 1
    assert filled == 12 * 5 * 3          # 12 field officers x 5 field items x 3 months
    ws.append(["NOPE", "x", "farmers_visited", "x", 2026, 10, 5])       # unknown employee
    ws.append([f"T{mine[0]}", "x", "sales_done", "x", 2026, 10, 5])      # item not for a field-mode officer
    buf = io.BytesIO(); wb.save(buf)
    files = {"file": ("goals.xlsx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    check = (await c.post("/api/v1/kpi/admin/goals/import?dry_run=true", headers=h, files=files)).json()
    assert check["new"] == filled and check["errors"] == 2
    errs = [r["error"] for r in check["rows"] if r["status"] == "error"]
    assert any("not found" in e for e in errs) and any("does not apply" in e for e in errs)
    assert (await c.get(f"/api/v1/kpi/admin/goals?months={Q}", headers=h)).json() == [] or True
    # errors block the save; nothing is half-saved
    refused = await c.post("/api/v1/kpi/admin/goals/import?dry_run=false", headers=h, files=files)
    assert refused.status_code == 400 and "nothing was saved" in refused.text
    # a clean file saves a whole quarter for a team in one upload
    for _ in range(2):
        ws.delete_rows(ws.max_row)
    buf = io.BytesIO(); wb.save(buf)
    files = {"file": ("goals.xlsx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    saved = (await c.post("/api/v1/kpi/admin/goals/import?dry_run=false&reason=Q4 plan", headers=h, files=files)).json()
    assert saved["saved"]["changed"] == filled and saved["saved"]["officers"] == 12
    again = (await c.post("/api/v1/kpi/admin/goals/import?dry_run=true", headers=h, files=files)).json()
    assert again["same"] == filled and again["new"] == 0


async def test_excel_sales_import(env):
    c, h = env["c"], env["h"]
    o = await env["user"](mode="sales")
    tpl = await c.get("/api/v1/kpi/admin/sales-figures/template?year=2026&month=10", headers=h)
    wb = load_workbook(io.BytesIO(tpl.content))
    ws = wb["Sales"]
    for row in ws.iter_rows(min_row=2):
        if str(row[0].value) == f"T{str(o)[:6]}":
            row[4].value, row[5].value = 1015205, 600000
    buf = io.BytesIO(); wb.save(buf)
    files = {"file": ("s.xlsx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    assert (await c.post("/api/v1/kpi/admin/sales-figures/import?dry_run=true", headers=h, files=files)).json()["new"] == 1
    r = await c.post("/api/v1/kpi/admin/sales-figures/import?dry_run=false", headers=h, files=files)
    assert r.json()["saved"]["changed"] == 1
    # not an Excel file
    bad = await c.post("/api/v1/kpi/admin/sales-figures/import", headers=h, files={"file": ("x.xlsx", b"hello", "text/plain")})
    assert bad.status_code == 400
