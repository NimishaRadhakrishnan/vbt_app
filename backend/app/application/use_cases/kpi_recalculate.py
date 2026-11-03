"""
RecalculatePerformance - the ONE place scores, levels and rupee amounts are
calculated. Screens read the snapshots this writes; nothing else does maths.

recalculate(session, officer_id, period_id) gathers the officer's numbers
(repository), runs the pure rules (domain/services/incentive_calculator),
and upserts one performance_snapshot row for today. Closed periods are
never touched - their frozen statement is the record.
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import asdict
from datetime import date
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.services import incentive_calculator as calc
from app.infrastructure.config.company_time import company_today
from app.infrastructure.repositories import kpi_data_repository as repo

logger = logging.getLogger("kpi.engine")

FIELD_CODES = ("farmers_visited", "villages_covered", "demo_agreed", "trial_area", "trial_to_paid")
SALES_CODES = ("sales_done", "focus_products", "money_collected", "dealer_health", "fo_follow_up", "daily_report")


def _f(v: Any) -> Any:
    """JSON-safe: Decimal -> float, recursively."""
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, dict):
        return {k: _f(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_f(x) for x in v]
    return v


# ------------------------------------------------------------------ periods


def period_bounds(kind: str, on: date, quarter_start_month: int = 4) -> tuple[date, date]:
    if kind == "month":
        start = date(on.year, on.month, 1)
        end = date(on.year + (on.month == 12), on.month % 12 + 1, 1)
    else:
        offset = (on.month - quarter_start_month) % 12
        first = on.month - (offset % 3)
        y = on.year
        if first < 1:
            first += 12
            y -= 1
        start = date(y, first, 1)
        nm = first + 3
        end = date(y + (nm > 12), nm - 12 if nm > 12 else nm, 1)
    from datetime import timedelta
    return start, end - timedelta(days=1)


async def ensure_period(s: AsyncSession, kind: str, on: date) -> dict:
    settings = await repo.get_settings_map(s)
    start, end = period_bounds(kind, on, int(settings.get("kpi.quarter_start_month", 4)))
    await s.execute(text(
        "INSERT INTO kpi_period (type, start_date, end_date) VALUES (:t, :s, :e) "
        "ON CONFLICT (type, start_date) DO NOTHING"
    ), {"t": kind, "s": start, "e": end})
    r = (await s.execute(text(
        "SELECT id, type, start_date, end_date, status FROM kpi_period WHERE type = :t AND start_date = :s"
    ), {"t": kind, "s": start})).one()
    return {"id": r.id, "type": r.type, "start": r.start_date, "end": r.end_date, "status": r.status}


# ------------------------------------------------------------ the two halves


def _rules(rules_rows: dict, settings: dict) -> calc.Rules:
    levels = [calc.Level(r.level, r.sales_min_pct, r.sales_rate, r.coll_min_pct, r.coll_rate) for r in rules_rows["levels"]]
    first = rules_rows["levels"][0] if rules_rows["levels"] else None
    return calc.Rules(
        levels=levels,
        entry_min_sales_pct=first.entry_min_sales_pct if first else Decimal("0.8"),
        level_gap=first.level_gap if first else 2,
        score_factor_max=Decimal(str(settings.get("kpi.score_factor_max_pct", 1.2))),
    )


def _weights(rules_rows: dict, codes: tuple[str, ...]) -> dict[str, tuple[Decimal, Decimal]]:
    return {w.code: (Decimal(w.weight), Decimal(w.cap_pct)) for w in rules_rows["weights"] if w.code in codes}


def _item_json(r: calc.ItemResult, extra: Optional[dict] = None) -> dict:
    d = {
        "weight": r.weight, "done": r.done, "goal": r.goal, "pct": r.pct, "marks": r.marks,
        "max_marks": r.max_marks, "skipped": r.skipped, "at_max": r.at_max,
    }
    d.update(extra or {})
    return d


async def _field_part(s: AsyncSession, officer_id: uuid.UUID, period: dict, rules_rows: dict, settings: dict) -> dict:
    start, end = period["start"], period["end"]
    window = int(settings.get("kpi.conversion_window_days", 60))
    goals = await repo.goals_for(s, officer_id, start, end)
    counts = await repo.field_counts(s, officer_id, start, end)
    ttp = await repo.trial_to_paid(s, officer_id, start, end, window)
    weights = _weights(rules_rows, FIELD_CODES)

    def goal(code: str, use_mean: bool = False) -> Decimal:
        g = goals.get(code)
        return (g[1] if use_mean else g[0]) if g else Decimal(0)

    done = {
        "farmers_visited": Decimal(counts["farmers"]),
        "villages_covered": Decimal(counts["villages"]),
        "demo_agreed": Decimal(counts["demo"]),
        "trial_area": counts["acres"],
        "trial_to_paid": (Decimal(ttp["paid"]) / ttp["trials"]) if ttp["trials"] else Decimal(0),
    }
    entries = [
        (c, weights[c][0], weights[c][1], done[c], goal(c, use_mean=(c == "trial_to_paid")))
        for c in FIELD_CODES if c in weights
    ]
    score, results = calc.score_items(entries)
    return {
        "score": score,
        "items": {r.code: _item_json(r) for r in results},
        "trial_funnel": {
            "visited": counts["farmers"], "agreed_demo": counts["demo"],
            "trials": ttp["trials"], "paid": ttp["paid"], "waiting": ttp["waiting"],
        },
    }


async def _sales_part(
    s: AsyncSession, officer: repo.Officer, period: dict, rules_rows: dict, settings: dict,
    own_field_score: Optional[Decimal], today: date,
) -> dict:
    start, end = period["start"], period["end"]
    goals = await repo.goals_for(s, officer.id, start, end)
    figures = await repo.sales_totals(s, officer.id, start, end)
    waiting = figures is None
    sales_paise, coll_paise = figures or (0, 0)
    weights = _weights(rules_rows, SALES_CODES)
    rules = _rules(rules_rows, settings)

    sales_goal = int(goals["sales_done"][0]) if "sales_done" in goals else 0
    coll_goal = int(goals["money_collected"][0]) if "money_collected" in goals else 0
    coll_goal_used = coll_goal or sales_goal   # empty collection goal falls back to the sales goal

    focus = await repo.focus_products(s, officer.id, period["id"], start, end)
    dealers = await repo.active_dealers(s, officer.id, start, end, int(settings.get("kpi.active_dealer_min_orders", 1)))
    dealer_goal = goals["dealer_health"][0] if "dealer_health" in goals else Decimal(0)

    # FO follow-up: average Field score of the field officers who report to this officer
    fo_ids = await repo.field_officers_under(s, officer.id)
    fo_scores = []
    for fid in fo_ids:
        fo_scores.append((await _field_part(s, fid, period, rules_rows, settings))["score"])
    if fo_scores:
        fo_avg = sum(fo_scores, Decimal(0)) / len(fo_scores)
    elif officer.work_mode == "both" and own_field_score is not None:
        fo_avg = own_field_score
    else:
        fo_avg = None

    daily = await repo.daily_report_ratio(s, officer.id, start, end, today)

    done_goal = {
        "sales_done": (Decimal(sales_paise), Decimal(sales_goal)),
        "focus_products": (focus["actual"], focus["expected"]),
        "money_collected": (Decimal(coll_paise), Decimal(coll_goal_used)),
        "dealer_health": (Decimal(dealers), dealer_goal),
        "fo_follow_up": (fo_avg or Decimal(0), Decimal(100) if fo_avg is not None else Decimal(0)),
        "daily_report": (Decimal(daily["on_time"]), Decimal(daily["working_days"])),
    }
    if waiting:   # no figures yet: do not mark the officer down for them
        done_goal["sales_done"] = (Decimal(0), Decimal(0))
        done_goal["money_collected"] = (Decimal(0), Decimal(0))

    entries = [(c, weights[c][0], weights[c][1], *done_goal[c]) for c in SALES_CODES if c in weights]
    score, results = calc.score_items(entries)

    out: dict = {
        "score": score,
        "items": {r.code: _item_json(r) for r in results},
        "waiting_for_figures": waiting,
        "focus": {k: v for k, v in focus.items()},
        "active_dealers": dealers,
        "working_days": daily["working_days"],
        "reports_on_time": daily["on_time"],
        "sales_paise": sales_paise, "collection_paise": coll_paise,
        "sales_goal_paise": sales_goal, "collection_goal_paise": coll_goal_used,
    }
    grade = calc.grade_for(score, [calc.GradeBand(g.grade, g.label, g.min_score) for g in rules_rows["grades"]])
    out["grade"] = grade.grade if grade else None
    out["grade_label"] = grade.label if grade else None

    if not waiting and sales_goal > 0:
        inc = calc.compute_incentive(sales_paise, sales_goal, coll_paise, coll_goal or None, rules, score)
        wi = calc.what_if(sales_paise, sales_goal, coll_paise, coll_goal or None, rules, score, inc)
        out["incentive"] = asdict(inc)
        out["what_if"] = asdict(wi)
    return out


# ---------------------------------------------------------------- the engine


async def recalculate(
    s: AsyncSession, officer_id: uuid.UUID, period_id: uuid.UUID, today: Optional[date] = None,
) -> Optional[dict]:
    """Recalculate one officer for one period and save today's snapshot."""
    today = today or company_today()
    p = (await s.execute(text(
        "SELECT id, type, start_date, end_date, status FROM kpi_period WHERE id = :i"), {"i": period_id})).first()
    if p is None or p.status == "closed":
        return None
    period = {"id": p.id, "type": p.type, "start": p.start_date, "end": p.end_date}
    officer = await repo.get_officer(s, officer_id)
    if officer is None or officer.role != "field_officer":
        return None

    settings = await repo.get_settings_map(s)
    rules_rows = await repo.rules_for(s, period["start"])
    if not rules_rows["weights"]:
        logger.error("kpi_no_weights period=%s", period_id)
        return None

    mode = officer.work_mode
    result: dict = {"mode": mode}
    field = sales = None
    if mode in ("field", "both"):
        field = await _field_part(s, officer_id, period, rules_rows, settings)
        result["field"] = field
    if mode in ("sales", "both"):
        sales = await _sales_part(s, officer, period, rules_rows, settings,
                                  field["score"] if field else None, today)
        result["sales"] = sales

    main_score = (sales or field)["score"]
    inc = (sales or {}).get("incentive")
    rule_version = rules_rows["levels"][0].effective_from if rules_rows["levels"] else None

    await s.execute(text("""
        INSERT INTO performance_snapshot
            (officer_id, period_id, snapshot_date, items, score, grade, sales_level, collection_level,
             level_match_applied, sales_incentive_paise, collection_incentive_paise, final_incentive_paise,
             waiting_for_figures, rule_version, calculated_at)
        VALUES (:o, :p, :d, CAST(:items AS jsonb), :score, :grade, :sl, :cl, :lm, :si, :ci, :fi, :w, :rv, now())
        ON CONFLICT (officer_id, period_id, snapshot_date) DO UPDATE SET
            items = EXCLUDED.items, score = EXCLUDED.score, grade = EXCLUDED.grade,
            sales_level = EXCLUDED.sales_level, collection_level = EXCLUDED.collection_level,
            level_match_applied = EXCLUDED.level_match_applied,
            sales_incentive_paise = EXCLUDED.sales_incentive_paise,
            collection_incentive_paise = EXCLUDED.collection_incentive_paise,
            final_incentive_paise = EXCLUDED.final_incentive_paise,
            waiting_for_figures = EXCLUDED.waiting_for_figures,
            rule_version = EXCLUDED.rule_version, calculated_at = now()
    """), {
        "o": officer_id, "p": period_id, "d": today,
        "items": json.dumps(_f(result)),
        "score": round(main_score, 2),
        "grade": (sales or {}).get("grade"),
        "sl": inc["sales_level"] if inc else None,
        "cl": inc["collection_level"] if inc else None,
        "lm": bool(inc and inc["level_match_applied"]),
        "si": int(inc["sales_incentive_paise"]) if inc else None,
        "ci": int(inc["collection_incentive_paise"]) if inc else None,
        "fi": inc["final_paise"] if inc else None,
        "w": bool(sales and sales["waiting_for_figures"]),
        "rv": rule_version,
    })
    return result


async def recalculate_for_date(s: AsyncSession, officer_id: uuid.UUID, on: Optional[date] = None) -> int:
    """Recalculate the month and the quarter that contain `on`. Returns periods done."""
    on = on or company_today()
    n = 0
    for kind in ("month", "quarter"):
        period = await ensure_period(s, kind, on)
        if await recalculate(s, officer_id, period["id"], today=company_today()) is not None:
            n += 1
    return n


async def recalculate_everyone(s: AsyncSession) -> tuple[int, int]:
    """Nightly full run: every active field officer, current month and quarter."""
    ids = [r.id for r in (await s.execute(text(
        "SELECT id FROM users WHERE role = 'field_officer' AND is_active = true AND is_deleted = false"))).all()]
    ok = failed = 0
    for oid in ids:
        try:
            await recalculate_for_date(s, oid)
            await s.commit()
            ok += 1
        except Exception:
            await s.rollback()
            failed += 1
            logger.exception("kpi_nightly_officer_failed officer=%s", oid)
    return ok, failed
