"""
Officer-facing read side of the Targets, KPI & Incentive module (phase 4).

Everything an officer sees on the Dashboard card and the My Goals screen is
assembled here from the saved snapshot plus the rules in force. Nothing is
calculated by the phone: the ladder, "next level" amounts, the what-if rupee
figures and the one-line advice all come from this module and the pure
incentive calculator. Text is deliberately friendly - "you are close",
"what to do next" - never a warning.
"""

from __future__ import annotations

import math
import uuid
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.use_cases import kpi_recalculate as eng
from app.domain.services import incentive_calculator as calc
from app.infrastructure.config.company_time import company_today, company_tz, is_weekly_working_day
from app.infrastructure.config.settings import get_settings
from app.infrastructure.repositories import kpi_data_repository as repo

MONEY = {"sales_done", "money_collected"}
SIMPLE_NAMES_FALLBACK = {
    "farmers_visited": "Farmers visited", "villages_covered": "Villages covered",
    "demo_agreed": "Farmers agreed for demo", "trial_area": "Area under trial",
    "trial_to_paid": "Trial to paid",
}
SERIES_ITEMS = ("farmers_visited", "villages_covered", "demo_agreed", "trial_area")


def _disp(code: str, v: Any) -> float:
    if v is None:
        return 0.0
    v = float(v)
    if code in MONEY:
        return v / 100
    if code == "trial_to_paid":
        return v * 100
    return v


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


async def _working_days_left(s: AsyncSession, today: date, end: date) -> int:
    if end < today:
        return 0
    hol = {r.date for r in (await s.execute(text(
        "SELECT date FROM holiday_calendar WHERE date BETWEEN :a AND :b"), {"a": today, "b": end})).all()}
    n, d = 0, today
    while d <= end:
        if is_weekly_working_day(d) and d not in hol:
            n += 1
        d += timedelta(days=1)
    return n


async def _item_meta(s: AsyncSession) -> dict[str, dict]:
    rows = (await s.execute(text(
        "SELECT code, simple_name, help_text, unit, mode FROM kpi_item WHERE active"))).all()
    return {r.code: {"name": r.simple_name, "help": r.help_text, "unit": r.unit, "mode": r.mode} for r in rows}


def _items_view(block: dict, meta: dict) -> list[dict]:
    out = []
    for code, it in block["items"].items():
        done, goal = _disp(code, it["done"]), _disp(code, it["goal"])
        out.append({
            "code": code, "name": meta.get(code, {}).get("name", code), "help": meta.get(code, {}).get("help"),
            "unit": meta.get(code, {}).get("unit"), "weight": it["weight"], "marks": round(it["marks"], 2),
            "max_marks": round(it["max_marks"], 2), "skipped": it["skipped"], "at_max": it["at_max"],
            "done": round(done, 2), "goal": round(goal, 2),
            "pct": None if it["pct"] is None else round(it["pct"], 4),
            "left": round(max(goal - done, 0), 2), "extra": round(max(done - goal, 0), 2),
        })
    return out


def _ladder(rules: calc.Rules, block: dict, score: Decimal) -> Optional[dict]:
    """Steps 0-3 with 'You are here', the rupees needed to climb and the
    incentive at each step (other numbers held at today's values)."""
    inc = block.get("incentive")
    s, c = block["sales_paise"], block["collection_paise"]
    sg, cg = block["sales_goal_paise"], block["collection_goal_paise"]
    if not inc or sg <= 0:
        return None
    rows = []
    for lv in sorted(rules.levels, key=lambda l: l.level):
        need_s = max(int(-(-(Decimal(sg) * lv.sales_min_pct - Decimal(s)) // 100)) * 100, 0)
        need_c = max(int(-(-(Decimal(cg) * lv.coll_min_pct - Decimal(c)) // 100)) * 100, 0)
        at_s = calc.compute_incentive(s + need_s, sg, c, cg, rules, score).final_paise
        at_c = calc.compute_incentive(s, sg, c + need_c, cg, rules, score).final_paise
        rows.append({"level": lv.level, "sales_min_pct": float(lv.sales_min_pct), "sales_rate": float(lv.sales_rate),
                     "coll_min_pct": float(lv.coll_min_pct), "coll_rate": float(lv.coll_rate),
                     "sales_needed_paise": need_s, "collection_needed_paise": need_c,
                     "incentive_at_sales_level_paise": at_s, "incentive_at_collection_level_paise": at_c})
    return {"rows": rows, "sales_level": inc["sales_level"], "collection_level": inc["collection_level"],
            "level_match_applied": inc["level_match_applied"], "entry_min_sales_pct": float(rules.entry_min_sales_pct)}


def _rupee(paise: int) -> str:
    n = int(round(paise / 100))
    s = str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:]); head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts + [tail])
    return "₹" + ("-" if n < 0 else "") + s


def _advice(mode_blocks: dict, items_by_code: dict, days_left: int, work_left: int, funnel: Optional[dict]) -> str:
    """The single most useful next step, in plain friendly words."""
    sales = mode_blocks.get("sales")
    if sales and sales.get("waiting_for_figures"):
        return "Your sales figures are not in yet. They will show here as soon as the office adds them."
    # close to the next incentive level? (within 10%)
    if sales and sales.get("what_if") and sales.get("incentive"):
        wi, sg = sales["what_if"], sales["sales_goal_paise"]
        if wi.get("collection_needed_paise") and sales["collection_goal_paise"] and \
                wi["collection_needed_paise"] <= 0.10 * sales["collection_goal_paise"]:
            return f"You are close. Collect {_rupee(wi['collection_needed_paise'])} more to reach Collection Level {wi['next_collection_level']}."
        if wi.get("sales_needed_paise") and sg and wi["sales_needed_paise"] <= 0.10 * sg:
            return f"You are close. Sell {_rupee(wi['sales_needed_paise'])} more to reach Level {wi['next_sales_level']}."
    pending = [i for i in items_by_code.values() if not i["skipped"] and i["pct"] is not None and i["pct"] < 1
               and i["code"] not in ("fo_follow_up", "daily_report", "focus_products", "dealer_health", "sales_done", "money_collected")]
    if pending:
        w = min(pending, key=lambda i: i["pct"])
        left = w["left"]
        per_day = max(1, math.ceil(left / max(work_left, 1)))
        code = w["code"]
        if code == "farmers_visited":
            return f"Visit {_plural(per_day, 'farmer')} a day to reach your goal."
        if code == "villages_covered":
            return f"Visit {_plural(math.ceil(left), 'more village')} to reach your goal. {days_left} days left."
        if code == "demo_agreed":
            return f"Ask {_plural(math.ceil(left), 'more farmer')} to agree for a demo."
        if code == "trial_area":
            return f"Start about {left:.1f} more acres of trials to reach your goal."
        if code == "trial_to_paid":
            waiting = (funnel or {}).get("waiting", 0)
            return f"Follow up with your trial farmers ({waiting} still waiting) to turn trials into sales." if waiting else "Follow up with your trial farmers to turn trials into sales."
    if sales:
        for code, label in (("dealer_health", "Get an order from {n} more dealer"), ("daily_report", "Send your day closure on the same day")):
            it = items_by_code.get(code)
            if it and not it["skipped"] and it["pct"] is not None and it["pct"] < 1:
                return label.format(n=math.ceil(it["left"])) + "."
    return "You have reached every goal so far. Well done!"


async def overview(s: AsyncSession, officer_id: uuid.UUID, kind: str) -> dict:
    today = company_today()
    period = await eng.ensure_period(s, kind, today)
    await eng.recalculate_for_date(s, officer_id, today)
    await s.commit()
    row = (await s.execute(text("""
        SELECT items, score, grade, final_incentive_paise, waiting_for_figures, calculated_at
        FROM performance_snapshot WHERE officer_id = :o AND period_id = :p
        ORDER BY snapshot_date DESC LIMIT 1"""), {"o": officer_id, "p": period["id"]})).first()
    officer = await repo.get_officer(s, officer_id)
    start, end = period["start"], period["end"]
    work_left = await _working_days_left(s, today, end)
    out: dict[str, Any] = {
        "period": {"type": kind, "start": start, "end": end, "status": period["status"],
                   "days_total": (end - start).days + 1, "days_left": max((end - today).days + 1, 0),
                   "working_days_left": work_left},
        "mode": officer.work_mode if officer else "both", "ready": row is not None,
    }
    from app.application.use_cases.kpi_nudges import latest_unread
    out["nudge"] = await latest_unread(s, officer_id)
    if row is None:
        out["advice"] = "Your goals will show here once the office has set them."
        return out
    data, meta = row.items, await _item_meta(s)
    settings = await repo.get_settings_map(s)
    rules_rows = await repo.rules_for(s, start)
    rules = eng._rules(rules_rows, settings)
    out["calculated_at"] = row.calculated_at
    all_items: dict[str, dict] = {}
    if "field" in data:
        f = data["field"]
        items = _items_view(f, meta)
        all_items.update({i["code"]: i for i in items})
        out["field"] = {"score": round(f["score"], 1), "items": items, "trial_funnel": f["trial_funnel"]}
    if "sales" in data:
        sl = data["sales"]
        items = _items_view(sl, meta)
        all_items.update({i["code"]: i for i in items})
        block: dict[str, Any] = {
            "score": round(sl["score"], 1), "grade": sl.get("grade"), "grade_label": sl.get("grade_label"),
            "items": items, "waiting_for_figures": sl["waiting_for_figures"],
            "sales_paise": sl["sales_paise"], "collection_paise": sl["collection_paise"],
            "sales_goal_paise": sl["sales_goal_paise"], "collection_goal_paise": sl["collection_goal_paise"],
            "focus": sl["focus"], "active_dealers": sl["active_dealers"],
        }
        if "incentive" in sl:
            inc = sl["incentive"]
            block["incentive"] = {
                "sales_level": inc["sales_level"], "collection_level": inc["collection_level"],
                "level_match_applied": inc["level_match_applied"], "entry_rule_applied": inc["entry_rule_applied"],
                "sales_pct": inc["sales_pct"], "collection_pct": inc["collection_pct"],
                "sales_incentive_paise": int(inc["sales_incentive_paise"]),
                "collection_incentive_paise": int(inc["collection_incentive_paise"]),
                "level_incentive_paise": int(inc["level_incentive_paise"]),
                "score_factor": inc["score_factor"], "earned_so_far_paise": inc["final_paise"],
            }
            wi = sl["what_if"]
            block["what_if"] = {**wi, "message": _what_if_message(wi, inc["final_paise"])}
            block["ladder"] = _ladder(rules, sl, Decimal(str(sl["score"])))
        out["sales"] = block
    funnel = out.get("field", {}).get("trial_funnel")
    out["advice"] = _advice(data, all_items, out["period"]["days_left"], work_left, funnel)
    return out


def _what_if_message(wi: dict, current_paise: int) -> Optional[str]:
    if wi.get("collection_needed_paise") and wi.get("next_collection_level"):
        msg = f"Collect {_rupee(wi['collection_needed_paise'])} more to reach Collection Level {wi['next_collection_level']}."
        if wi.get("collection_also_restores_sales"):
            msg += " This also brings your Sales level back up."
        if wi.get("collection_extra_paise"):
            msg += f" Your incentive goes from {_rupee(current_paise)} to about {_rupee(current_paise + wi['collection_extra_paise'])} (at today's score)."
        return msg
    if wi.get("sales_needed_paise") and wi.get("next_sales_level"):
        msg = f"Sell {_rupee(wi['sales_needed_paise'])} more to reach Level {wi['next_sales_level']}."
        if wi.get("sales_extra_paise"):
            msg += f" Your incentive goes from {_rupee(current_paise)} to about {_rupee(current_paise + wi['sales_extra_paise'])} (at today's score)."
        return msg
    return None


# ------------------------------------------------------------ charts + lists

_DAY = "(v.start_time AT TIME ZONE :tz)::date"


async def series(s: AsyncSession, officer_id: uuid.UUID, kind: str, code: str) -> dict:
    """Actual vs needed pace across the days of the period (cumulative)."""
    if code not in SERIES_ITEMS:
        raise ValueError("A pace line is only available for the visit-based goals.")
    today = company_today()
    period = await eng.ensure_period(s, kind, today)
    start, end = period["start"], min(period["end"], today)
    p = {"o": officer_id, "s": period["start"], "e": period["end"], "tz": get_settings().company_timezone}
    if code == "farmers_visited":
        q = f"SELECT d, 1 AS n FROM (SELECT min({_DAY}) AS d FROM visits v WHERE v.user_id = :o AND v.farmer_id IS NOT NULL AND {_DAY} BETWEEN :s AND :e GROUP BY v.farmer_id) x"
    elif code == "villages_covered":
        q = f"SELECT d, 1 AS n FROM (SELECT min({_DAY}) AS d FROM visits v JOIN farmers f ON f.id = v.farmer_id WHERE v.user_id = :o AND {_DAY} BETWEEN :s AND :e GROUP BY lower(btrim(f.village))) x"
    elif code == "demo_agreed":
        q = (f"SELECT d, 1 AS n FROM (SELECT min({_DAY}) AS d FROM visits v JOIN visit_trial_details t ON t.visit_id = v.id "
             f"WHERE v.user_id = :o AND v.farmer_id IS NOT NULL AND t.demo_status = ANY(:st) AND {_DAY} BETWEEN :s AND :e GROUP BY v.farmer_id) x")
        p["st"] = list(repo.AGREED_STAGES)
    else:
        q = (f"SELECT {_DAY} AS d, coalesce(sum(t.trial_plot_size_cents), 0) / 100.0 AS n FROM visits v "
             f"JOIN visit_trial_details t ON t.visit_id = v.id WHERE v.user_id = :o AND v.is_trial = true AND {_DAY} BETWEEN :s AND :e GROUP BY 1")
    per_day = {r.d: float(r.n) for r in (await s.execute(text(q), p)).all()}
    goals = await repo.goals_for(s, officer_id, period["start"], period["end"])
    goal = float(goals[code][0]) if code in goals else 0.0
    total_days = (period["end"] - period["start"]).days + 1
    points, run, d = [], 0.0, start
    while d <= end:
        run += per_day.get(d, 0.0)
        idx = (d - period["start"]).days + 1
        points.append({"date": d, "actual": round(run, 2), "needed": round(goal * idx / total_days, 2)})
        d += timedelta(days=1)
    return {"code": code, "goal": goal, "points": points, "start": period["start"], "end": period["end"],
            "sentence": "The dotted line is where you should be today. If your line is above it, you are ahead."}


async def calendar(s: AsyncSession, officer_id: uuid.UUID, month: date) -> dict:
    first = date(month.year, month.month, 1)
    last = (date(first.year + (first.month == 12), first.month % 12 + 1, 1)) - timedelta(days=1)
    today = company_today()
    p = {"o": officer_id, "s": first, "e": last, "tz": get_settings().company_timezone}
    visits = {r.d: r.n for r in (await s.execute(text(
        f"SELECT {_DAY} AS d, count(*) AS n FROM visits v WHERE v.user_id = :o AND {_DAY} BETWEEN :s AND :e GROUP BY 1"), p)).all()}
    closed = {r.date for r in (await s.execute(text(
        "SELECT date FROM day_closures WHERE officer_id = :o AND is_deleted = false AND date BETWEEN :s AND :e"), p)).all()}
    hol = {r.date: r.description for r in (await s.execute(text(
        "SELECT date, description FROM holiday_calendar WHERE date BETWEEN :s AND :e"), p)).all()}
    leave: set[date] = set()
    for r in (await s.execute(text(
        "SELECT start_date, end_date FROM leave_requests WHERE officer_id = :o AND status = 'approved' AND is_deleted = false "
        "AND start_date <= :e AND end_date >= :s"), p)).all():
        d = max(r.start_date, first)
        while d <= min(r.end_date, last):
            leave.add(d); d += timedelta(days=1)
    days, d = [], first
    while d <= last:
        kind = ("future" if d > today else "holiday" if d in hol else "sunday" if not is_weekly_working_day(d)
                else "leave" if d in leave else "work")
        if d in hol and d <= today:
            kind = "holiday"
        days.append({"date": d, "visits": int(visits.get(d, 0)), "closed": d in closed, "kind": kind,
                     "note": hol.get(d)})
        d += timedelta(days=1)
    return {"month": first, "days": days, "max_visits": max([x["visits"] for x in days] + [1]),
            "sentence": "Darker days mean more work done. Holidays and leave are grey - they never count against you."}


async def best_months(s: AsyncSession, officer_id: uuid.UUID) -> list[dict]:
    """Personal best month for each item - compete with yourself."""
    rows = (await s.execute(text("""
        SELECT DISTINCT ON (ps.period_id) ps.items, p.start_date
        FROM performance_snapshot ps JOIN kpi_period p ON p.id = ps.period_id
        WHERE ps.officer_id = :o AND p.type = 'month'
        ORDER BY ps.period_id, ps.snapshot_date DESC"""), {"o": officer_id})).all()
    meta = await _item_meta(s)
    best: dict[str, dict] = {}
    for r in rows:
        for part in ("field", "sales"):
            for code, it in (r.items.get(part) or {}).get("items", {}).items():
                if code in ("fo_follow_up", "daily_report") or it["skipped"]:
                    continue
                v = _disp(code, it["done"])
                if v > 0 and (code not in best or v > best[code]["value"]):
                    best[code] = {"code": code, "name": meta.get(code, {}).get("name", code), "value": round(v, 2),
                                  "month": r.start_date, "unit": meta.get(code, {}).get("unit")}
    return sorted(best.values(), key=lambda b: b["name"])


async def past(s: AsyncSession, officer_id: uuid.UUID, kind: str) -> list[dict]:
    today = company_today()
    rows = (await s.execute(text("""
        SELECT DISTINCT ON (p.id) p.id AS period_id, p.start_date, p.end_date, p.status, ps.score, ps.grade, ps.sales_level, ps.collection_level,
               ps.final_incentive_paise, ps.waiting_for_figures, ps.snapshot_date, st.status AS statement, st.final_amount_paise
        FROM kpi_period p JOIN performance_snapshot ps ON ps.period_id = p.id AND ps.officer_id = :o
        LEFT JOIN incentive_statement st ON st.period_id = p.id AND st.officer_id = :o
        WHERE p.type = :k AND p.end_date < :t
        ORDER BY p.id, ps.snapshot_date DESC"""), {"o": officer_id, "k": kind, "t": today})).all()
    out = [{"period_id": str(r.period_id), "start": r.start_date, "end": r.end_date, "closed": r.status == "closed",
            "score": float(r.score) if r.score is not None else None, "grade": r.grade,
            "sales_level": r.sales_level, "collection_level": r.collection_level,
            # money is shown only once the admin has closed the period and issued the statement
            "statement_status": r.statement, "final_amount_paise": r.final_amount_paise if r.statement else None,
            "waiting_for_figures": r.waiting_for_figures} for r in rows]
    return sorted(out, key=lambda x: x["start"], reverse=True)


async def entries(s: AsyncSession, officer_id: uuid.UUID, kind: str, code: str) -> dict:
    """The list of entries behind a number."""
    today = company_today()
    period = await eng.ensure_period(s, kind, today)
    p = {"o": officer_id, "s": period["start"], "e": period["end"], "tz": get_settings().company_timezone}
    rows: list[dict] = []
    if code == "farmers_visited":
        q = (f"SELECT f.name, f.village, min({_DAY}) AS d, count(*) AS n FROM visits v JOIN farmers f ON f.id = v.farmer_id "
             f"WHERE v.user_id = :o AND {_DAY} BETWEEN :s AND :e GROUP BY f.id ORDER BY d DESC")
        rows = [{"title": r.name, "subtitle": f"{r.village} · {r.n} visit{'s' if r.n != 1 else ''}", "date": r.d}
                for r in (await s.execute(text(q), p)).all()]
    elif code == "villages_covered":
        q = (f"SELECT initcap(btrim(f.village)) AS village, count(DISTINCT v.farmer_id) AS farmers, max({_DAY}) AS d "
             f"FROM visits v JOIN farmers f ON f.id = v.farmer_id WHERE v.user_id = :o AND {_DAY} BETWEEN :s AND :e "
             f"GROUP BY lower(btrim(f.village)), initcap(btrim(f.village)) ORDER BY d DESC")
        rows = [{"title": r.village, "subtitle": f"{r.farmers} farmer{'s' if r.farmers != 1 else ''}", "date": r.d}
                for r in (await s.execute(text(q), p)).all()]
    elif code == "demo_agreed":
        q = (f"SELECT f.name, f.village, t.demo_status, max({_DAY}) AS d FROM visits v JOIN farmers f ON f.id = v.farmer_id "
             f"JOIN visit_trial_details t ON t.visit_id = v.id WHERE v.user_id = :o AND t.demo_status = ANY(:st) AND {_DAY} BETWEEN :s AND :e "
             f"GROUP BY f.id, t.demo_status ORDER BY d DESC")
        rows = [{"title": r.name, "subtitle": f"{r.village} · {r.demo_status.replace('_', ' ')}", "date": r.d}
                for r in (await s.execute(text(q), {**p, "st": list(repo.AGREED_STAGES)})).all()]
    elif code == "trial_area":
        q = (f"SELECT f.name, f.village, t.trial_plot_size_cents AS c, {_DAY} AS d FROM visits v JOIN farmers f ON f.id = v.farmer_id "
             f"JOIN visit_trial_details t ON t.visit_id = v.id WHERE v.user_id = :o AND v.is_trial = true AND {_DAY} BETWEEN :s AND :e ORDER BY d DESC")
        rows = [{"title": r.name, "subtitle": f"{r.village} · {float(r.c or 0) / 100:.2f} acres", "date": r.d}
                for r in (await s.execute(text(q), p)).all()]
    elif code == "trial_to_paid":
        window = int((await repo.get_settings_map(s)).get("kpi.conversion_window_days", 60))
        q = (f"WITH t AS (SELECT v.farmer_id, min(v.start_time) AS at FROM visits v WHERE v.user_id = :o AND v.is_trial = true "
             f"AND v.farmer_id IS NOT NULL AND {_DAY} BETWEEN :s AND :e GROUP BY v.farmer_id) "
             f"SELECT f.name, f.village, t.at, EXISTS (SELECT 1 FROM visits v2 LEFT JOIN visit_sales vs ON vs.visit_id = v2.id "
             f"LEFT JOIN visit_trial_details d2 ON d2.visit_id = v2.id WHERE v2.farmer_id = t.farmer_id AND v2.start_time >= t.at "
             f"AND v2.start_time <= t.at + make_interval(days => :w) AND (vs.purchased = true OR d2.demo_status = 'converted')) AS paid "
             f"FROM t JOIN farmers f ON f.id = t.farmer_id ORDER BY t.at DESC")
        for r in (await s.execute(text(q), {**p, "w": window})).all():
            waiting = (not r.paid) and (r.at + timedelta(days=window)).date() >= today
            rows.append({"title": r.name, "subtitle": f"{r.village} · " + ("Bought" if r.paid else "Waiting" if waiting else "Not yet"),
                         "date": r.at.date()})
    elif code == "dealer_health":
        q = ("SELECT d.name, count(*) AS n, max(o.order_date)::date AS dt FROM dealer_orders o JOIN dealers d ON d.id = o.dealer_id "
             "WHERE o.created_by = :o AND o.status <> ALL(:bad) AND (o.order_date AT TIME ZONE :tz)::date BETWEEN :s AND :e "
             "GROUP BY d.id ORDER BY dt DESC")
        rows = [{"title": r.name, "subtitle": f"{r.n} order{'s' if r.n != 1 else ''}", "date": r.dt}
                for r in (await s.execute(text(q), {**p, "bad": list(repo.NOT_AN_ORDER)})).all()]
    elif code == "daily_report":
        q = "SELECT date, created_at FROM day_closures WHERE officer_id = :o AND is_deleted = false AND date BETWEEN :s AND :e ORDER BY date DESC"
        rows = [{"title": "Day closure sent", "subtitle": "On the same day" if r.created_at.astimezone(company_tz()).date() == r.date else "Sent late",
                 "date": r.date} for r in (await s.execute(text(q), p)).all()]
    elif code in ("sales_done", "money_collected"):
        q = ("SELECT year, month, sales_amount_paise AS s, collection_amount_paise AS c FROM sales_figure WHERE officer_id = :o "
             "AND (year * 100 + month) = ANY(:ym) ORDER BY year DESC, month DESC")
        ym = [y * 100 + m for y, m in repo.months_in(period["start"], period["end"])]
        for r in (await s.execute(text(q), {"o": officer_id, "ym": ym})).all():
            val = r.s if code == "sales_done" else r.c
            rows.append({"title": date(r.year, r.month, 1).strftime("%B %Y"), "subtitle": f"₹{val // 100:,}", "date": date(r.year, r.month, 1)})
    elif code == "focus_products":
        q = ("SELECT pr.name, f.expected, f.unit FROM focus_product_plan f JOIN products pr ON pr.id = f.product_id "
             "WHERE f.period_id = :p AND f.officer_id = :o ORDER BY pr.name")
        rows = [{"title": r.name, "subtitle": f"Expected {float(r.expected):,.0f} {'₹' if r.unit == 'rupees' else 'units'}", "date": None}
                for r in (await s.execute(text(q), {"p": period["id"], "o": officer_id})).all()]
    else:
        raise ValueError("No list is available for this item.")
    return {"code": code, "count": len(rows), "rows": rows[:200]}

