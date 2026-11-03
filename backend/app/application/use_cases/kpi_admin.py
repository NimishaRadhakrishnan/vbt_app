"""
Admin side of the Targets, KPI & Incentive module (phase 3).

Everything an admin can change lives here: goals (grid, yearly split, copy
last year, apply to region), month weights, versioned rules, single-value
settings, sales/collection figures, focus products, Excel template/import,
and the change history. Every create/edit/delete writes kpi_audit_log
(who, when, old value, new value, reason) and queues the affected officers
for recalculation. Screens and routers never calculate anything.

Units in and out of this module are what an admin types and reads:
rupees for sales/collection goals and figures, percent for Trial to paid,
counts and acres otherwise. Storage units (paise, 0-1 ratio) are converted
at this boundary only.
"""

from __future__ import annotations

import io
import json
import uuid
from datetime import date
from decimal import ROUND_FLOOR, Decimal
from typing import Any, Iterable, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.use_cases.kpi_recalculate import ensure_period
from app.infrastructure.cache.kpi_queue import enqueue_with_manager
from app.infrastructure.repositories import kpi_data_repository as repo

GOAL_CODES = (
    "farmers_visited", "villages_covered", "demo_agreed", "trial_area", "trial_to_paid",
    "sales_done", "money_collected", "dealer_health",
)
MONEY_CODES = {"sales_done", "money_collected"}
PERCENT_CODES = {"trial_to_paid"}
DECIMALS = {"trial_area": 2}          # places kept when a yearly goal is split
ITEM_MODE = {
    "farmers_visited": "field", "villages_covered": "field", "demo_agreed": "field",
    "trial_area": "field", "trial_to_paid": "field",
    "sales_done": "sales", "money_collected": "sales", "dealer_health": "sales",
}


class KpiAdminError(ValueError):
    """A problem the admin can fix (shown as a 400 with this message)."""


# ------------------------------------------------------------------ units


def to_storage(code: str, value: Any) -> Decimal:
    v = Decimal(str(value))
    if v < 0:
        raise KpiAdminError("Goals and figures cannot be negative.")
    if code in MONEY_CODES:
        return (v * 100).quantize(Decimal(1))
    if code in PERCENT_CODES:
        if v > 100:
            raise KpiAdminError("Trial to paid is a percentage - use 0 to 100.")
        return (v / 100).quantize(Decimal("0.0001"))
    return v.quantize(Decimal("0.0001"))


def from_storage(code: str, value: Decimal) -> float:
    v = Decimal(value)
    if code in MONEY_CODES:
        return float(v / 100)
    if code in PERCENT_CODES:
        return float(v * 100)
    return float(v)


# ------------------------------------------------------------------ audit


async def audit(s: AsyncSession, entity: str, entity_id: Optional[uuid.UUID], action: str,
                old: Any, new: Any, reason: Optional[str], user_id: uuid.UUID) -> None:
    await s.execute(text("""
        INSERT INTO kpi_audit_log (entity, entity_id, action, old, new, reason, user_id)
        VALUES (:e, :i, :a, CAST(:o AS jsonb), CAST(:n AS jsonb), :r, :u)
    """), {"e": entity, "i": entity_id, "a": action,
           "o": json.dumps(old, default=str) if old is not None else None,
           "n": json.dumps(new, default=str) if new is not None else None,
           "r": (reason or None) and reason[:300], "u": user_id})


async def _queue(s: AsyncSession, officer_ids: Iterable[uuid.UUID]) -> None:
    for oid in set(officer_ids):
        await enqueue_with_manager(s, oid)


# ------------------------------------------------------------- officers/items


async def list_officers(s: AsyncSession) -> list[dict]:
    rows = (await s.execute(text("""
        SELECT u.id, u.full_name, u.employee_id, u.work_mode, u.manager_id,
               coalesce(array_agg(t.name ORDER BY t.name) FILTER (WHERE t.name IS NOT NULL), '{}') AS regions,
               coalesce(array_agg(t.id) FILTER (WHERE t.id IS NOT NULL), '{}') AS region_ids
        FROM users u
        LEFT JOIN user_territories ut ON ut.user_id = u.id
        LEFT JOIN territories t ON t.id = ut.territory_id
        WHERE u.role = 'field_officer' AND u.is_active = true AND u.is_deleted = false
        GROUP BY u.id ORDER BY u.full_name
    """))).all()
    return [{"id": str(r.id), "name": r.full_name, "employee_id": r.employee_id, "work_mode": r.work_mode,
             "manager_id": str(r.manager_id) if r.manager_id else None,
             "regions": list(r.regions), "region_ids": [str(x) for x in r.region_ids]} for r in rows]


async def list_items(s: AsyncSession) -> list[dict]:
    rows = (await s.execute(text(
        "SELECT code, simple_name, help_text, mode, unit, sort_order FROM kpi_item WHERE active ORDER BY sort_order"))).all()
    unit_label = {"rupees": "₹", "percent": "%", "acres": "acres", "count": "", "score": ""}
    return [{"code": r.code, "name": r.simple_name, "help": r.help_text, "mode": r.mode, "unit": r.unit,
             "unit_label": unit_label.get(r.unit, ""), "has_goal": r.code in GOAL_CODES} for r in rows]


async def _officers_in_region(s: AsyncSession, region_id: uuid.UUID) -> list[uuid.UUID]:
    rows = (await s.execute(text("""
        SELECT u.id FROM users u JOIN user_territories ut ON ut.user_id = u.id
        WHERE ut.territory_id = :r AND u.role = 'field_officer' AND u.is_active = true AND u.is_deleted = false
    """), {"r": region_id})).all()
    return [r.id for r in rows]


async def _mode_of(s: AsyncSession, officer_id: uuid.UUID) -> str:
    r = (await s.execute(text("SELECT work_mode FROM users WHERE id = :i"), {"i": officer_id})).first()
    return r.work_mode if r else "both"


def _item_applies(code: str, work_mode: str) -> bool:
    return work_mode == "both" or ITEM_MODE[code] == work_mode


# ------------------------------------------------------------------- goals


def parse_months(spec: str) -> list[tuple[int, int]]:
    out = []
    for part in spec.split(","):
        try:
            y, m = part.strip().split("-")
            y, m = int(y), int(m)
        except ValueError:
            raise KpiAdminError(f"Month '{part}' should look like 2026-10.")
        if not 1 <= m <= 12:
            raise KpiAdminError(f"Month '{part}' is not a month.")
        out.append((y, m))
    if not out or len(out) > 12:
        raise KpiAdminError("Pick between 1 and 12 months.")
    return out


async def get_goals(s: AsyncSession, months: list[tuple[int, int]]) -> list[dict]:
    rows = (await s.execute(text("""
        SELECT g.officer_id, i.code, g.year, g.month, g.value
        FROM goal g JOIN kpi_item i ON i.id = g.item_id
        WHERE (g.year * 100 + g.month) = ANY(:ym)
    """), {"ym": [y * 100 + m for y, m in months]})).all()
    return [{"officer_id": str(r.officer_id), "code": r.code, "year": r.year, "month": r.month,
             "value": from_storage(r.code, r.value)} for r in rows]


async def _upsert_goal(s: AsyncSession, user_id: uuid.UUID, officer_id: uuid.UUID, code: str,
                       year: int, month: int, value: Any, reason: Optional[str]) -> bool:
    if code not in GOAL_CODES:
        raise KpiAdminError(f"'{code}' does not take a goal.")
    if not 1 <= month <= 12:
        raise KpiAdminError("Month must be 1 to 12.")
    new = to_storage(code, value)
    item_id = (await s.execute(text("SELECT id FROM kpi_item WHERE code = :c"), {"c": code})).scalar_one()
    cur = (await s.execute(text(
        "SELECT id, value FROM goal WHERE officer_id = :o AND item_id = :i AND year = :y AND month = :m"),
        {"o": officer_id, "i": item_id, "y": year, "m": month})).first()
    if cur and Decimal(cur.value) == new:
        return False
    if cur:
        await s.execute(text("UPDATE goal SET value = :v, set_by = :u, updated_at = now() WHERE id = :id"),
                        {"v": new, "u": user_id, "id": cur.id})
        gid, action, old = cur.id, "update", from_storage(code, cur.value)
    else:
        gid = (await s.execute(text(
            "INSERT INTO goal (officer_id, item_id, year, month, value, set_by) VALUES (:o, :i, :y, :m, :v, :u) RETURNING id"),
            {"o": officer_id, "i": item_id, "y": year, "m": month, "v": new, "u": user_id})).scalar_one()
        action, old = "create", None
    await audit(s, "goal", gid, action, {"value": old} if old is not None else None,
                {"officer_id": str(officer_id), "item": code, "year": year, "month": month,
                 "value": from_storage(code, new)}, reason, user_id)
    return True


async def save_goals(s: AsyncSession, user_id: uuid.UUID, cells: list[dict], reason: Optional[str]) -> dict:
    changed: set[uuid.UUID] = set()
    n = 0
    for c in cells:
        oid = uuid.UUID(str(c["officer_id"]))
        if await _upsert_goal(s, user_id, oid, c["code"], int(c["year"]), int(c["month"]), c["value"], reason):
            changed.add(oid)
            n += 1
    await s.commit()
    await _queue(s, changed)
    return {"changed": n, "officers": len(changed)}


def split_amount(total: Decimal, weights: list[Decimal], places: int) -> list[Decimal]:
    """Split `total` across weights so the parts add up to exactly `total`
    (largest-remainder), each part kept to `places` decimals."""
    unit = Decimal(1).scaleb(-places)
    wsum = sum(weights)
    if wsum <= 0:
        weights, wsum = [Decimal(1)] * len(weights), Decimal(len(weights))
    exact = [total * w / wsum for w in weights]
    parts = [(x / unit).to_integral_value(rounding=ROUND_FLOOR) * unit for x in exact]
    left = int(((total - sum(parts)) / unit).to_integral_value())
    order = sorted(range(len(parts)), key=lambda i: exact[i] - parts[i], reverse=True)
    for i in order[:max(left, 0)]:
        parts[i] += unit
    return parts


async def _fy_months(s: AsyncSession, fy_year: int) -> list[tuple[int, int]]:
    start_month = int((await repo.get_settings_map(s)).get("kpi.quarter_start_month", 4))
    out, y, m = [], fy_year, start_month
    for _ in range(12):
        out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


async def _month_weights(s: AsyncSession, officer_id: uuid.UUID, months: list[tuple[int, int]]) -> list[Decimal]:
    """Season weights from the officer's first region; equal when none are set."""
    region = (await s.execute(text(
        "SELECT territory_id FROM user_territories WHERE user_id = :o ORDER BY assigned_at LIMIT 1"),
        {"o": officer_id})).scalar_one_or_none()
    if region:
        rows = (await s.execute(text(
            "SELECT year, month, weight FROM month_weight WHERE region_id = :r AND (year * 100 + month) = ANY(:ym)"),
            {"r": region, "ym": [y * 100 + m for y, m in months]})).all()
        have = {(r.year, r.month): Decimal(r.weight) for r in rows}
        if have:
            return [have.get(ym, Decimal(1)) for ym in months]
    return [Decimal(1)] * len(months)


async def split_yearly(s: AsyncSession, user_id: uuid.UUID, code: str, fy_year: int, yearly_value: Any,
                       officer_ids: list[uuid.UUID], region_id: Optional[uuid.UUID], reason: Optional[str]) -> dict:
    """Set a yearly goal and split it into months by the season weights."""
    if code not in GOAL_CODES:
        raise KpiAdminError(f"'{code}' does not take a goal.")
    ids = list(officer_ids)
    if region_id:
        ids += await _officers_in_region(s, region_id)
    ids = list(dict.fromkeys(ids))
    if not ids:
        raise KpiAdminError("Pick at least one officer or a region.")
    months = await _fy_months(s, fy_year)
    total = Decimal(str(yearly_value))
    if total < 0:
        raise KpiAdminError("Goals cannot be negative.")
    changed = 0
    done: list[uuid.UUID] = []
    for oid in ids:
        if not _item_applies(code, await _mode_of(s, oid)):
            continue
        if code in PERCENT_CODES:        # a percentage is a target, not an amount: same every month
            parts = [total] * len(months)
        else:
            parts = split_amount(total, await _month_weights(s, oid, months), DECIMALS.get(code, 0))
        for (y, m), v in zip(months, parts):
            if await _upsert_goal(s, user_id, oid, code, y, m, v, reason):
                changed += 1
        done.append(oid)
    await s.commit()
    await _queue(s, done)
    return {"officers": len(done), "changed": changed}


async def copy_last_year(s: AsyncSession, user_id: uuid.UUID, months: list[tuple[int, int]],
                         officer_ids: Optional[list[uuid.UUID]], overwrite: bool, reason: Optional[str]) -> dict:
    changed, touched = 0, set()
    for (y, m) in months:
        rows = (await s.execute(text("""
            SELECT g.officer_id, i.code, g.value FROM goal g JOIN kpi_item i ON i.id = g.item_id
            WHERE g.year = :y AND g.month = :m
        """), {"y": y - 1, "m": m})).all()
        for r in rows:
            if officer_ids and r.officer_id not in officer_ids:
                continue
            if not overwrite:
                exists = (await s.execute(text("""
                    SELECT 1 FROM goal g JOIN kpi_item i ON i.id = g.item_id
                    WHERE g.officer_id = :o AND i.code = :c AND g.year = :y AND g.month = :m
                """), {"o": r.officer_id, "c": r.code, "y": y, "m": m})).first()
                if exists:
                    continue
            if await _upsert_goal(s, user_id, r.officer_id, r.code, y, m, from_storage(r.code, r.value),
                                  reason or "Copied from last year"):
                changed += 1
                touched.add(r.officer_id)
    await s.commit()
    await _queue(s, touched)
    return {"changed": changed, "officers": len(touched)}


async def apply_to_region(s: AsyncSession, user_id: uuid.UUID, source_officer_id: uuid.UUID,
                          region_id: uuid.UUID, months: list[tuple[int, int]], reason: Optional[str]) -> dict:
    """Copy one officer's goals for these months to every other officer in the region."""
    src = (await s.execute(text("""
        SELECT i.code, g.year, g.month, g.value FROM goal g JOIN kpi_item i ON i.id = g.item_id
        WHERE g.officer_id = :o AND (g.year * 100 + g.month) = ANY(:ym)
    """), {"o": source_officer_id, "ym": [y * 100 + m for y, m in months]})).all()
    if not src:
        raise KpiAdminError("That officer has no goals for these months to copy.")
    targets = [o for o in await _officers_in_region(s, region_id) if o != source_officer_id]
    changed, touched = 0, set()
    for oid in targets:
        mode = await _mode_of(s, oid)
        for r in src:
            if r.code in GOAL_CODES and _item_applies(r.code, mode):
                if await _upsert_goal(s, user_id, oid, r.code, r.year, r.month, from_storage(r.code, r.value),
                                      reason or "Applied to region"):
                    changed += 1
                    touched.add(oid)
    await s.commit()
    await _queue(s, touched)
    return {"officers": len(targets), "changed": changed}


async def get_month_weights(s: AsyncSession, region_id: uuid.UUID, year: int) -> list[dict]:
    rows = (await s.execute(text("SELECT month, weight FROM month_weight WHERE region_id = :r AND year = :y"),
                            {"r": region_id, "y": year})).all()
    have = {r.month: float(r.weight) for r in rows}
    return [{"month": m, "weight": have.get(m, 1.0)} for m in range(1, 13)]


async def set_month_weights(s: AsyncSession, user_id: uuid.UUID, region_id: uuid.UUID, year: int,
                            weights: list[dict], reason: Optional[str]) -> None:
    old = await get_month_weights(s, region_id, year)
    for w in weights:
        m, v = int(w["month"]), Decimal(str(w["weight"]))
        if not 1 <= m <= 12 or v < 0:
            raise KpiAdminError("Month weights must be 0 or more, for months 1 to 12.")
        await s.execute(text("""
            INSERT INTO month_weight (region_id, year, month, weight) VALUES (:r, :y, :m, :w)
            ON CONFLICT (region_id, year, month) DO UPDATE SET weight = EXCLUDED.weight
        """), {"r": region_id, "y": year, "m": m, "w": v})
    await audit(s, "month_weight", region_id, "update", {"year": year, "weights": old},
                {"year": year, "weights": weights}, reason, user_id)
    await s.commit()


# ------------------------------------------------------------------- rules


async def get_rules(s: AsyncSession, on: Optional[date] = None) -> dict:
    from app.infrastructure.config.company_time import company_today
    on = on or company_today()
    r = await repo.rules_for(s, on)
    versions = (await s.execute(text("""
        SELECT effective_from FROM incentive_rule_set UNION SELECT effective_from FROM kpi_weight_set
        UNION SELECT effective_from FROM grade_band ORDER BY effective_from DESC"""))).all()
    levels = r["levels"]
    return {
        "in_force_on": on,
        "weights": [{"code": w.code, "mode": w.mode, "weight": float(w.weight), "cap_pct": float(w.cap_pct),
                     "effective_from": w.effective_from} for w in r["weights"]],
        "levels": [{"level": l.level, "sales_min_pct": float(l.sales_min_pct), "sales_rate": float(l.sales_rate),
                    "coll_min_pct": float(l.coll_min_pct), "coll_rate": float(l.coll_rate)} for l in levels],
        "entry_min_sales_pct": float(levels[0].entry_min_sales_pct) if levels else 0.8,
        "level_gap": levels[0].level_gap if levels else 2,
        "level_version": levels[0].effective_from if levels else None,
        "grades": [{"grade": g.grade, "label": g.label, "min_score": float(g.min_score)} for g in
                   sorted(r["grades"], key=lambda g: g.min_score, reverse=True)],
        "settings": await repo.get_settings_map(s),
        "versions": [v.effective_from for v in versions],
    }


def _validate_rules(body: dict) -> None:
    sums = {"field": Decimal(0), "sales": Decimal(0)}
    modes = {"farmers_visited": "field", "villages_covered": "field", "demo_agreed": "field",
             "trial_area": "field", "trial_to_paid": "field", "sales_done": "sales", "focus_products": "sales",
             "money_collected": "sales", "dealer_health": "sales", "fo_follow_up": "sales", "daily_report": "sales"}
    for w in body.get("weights") or []:
        if w["code"] not in modes:
            raise KpiAdminError(f"Unknown score item '{w['code']}'.")
        if Decimal(str(w["weight"])) < 0 or Decimal(str(w["cap_pct"])) < 1:
            raise KpiAdminError("Marks cannot be negative and the cap must be at least 100%.")
        sums[modes[w["code"]]] += Decimal(str(w["weight"]))
    if body.get("weights"):
        for mode, label in (("field", "Field"), ("sales", "Sales")):
            if sums[mode] != 100:
                raise KpiAdminError(f"{label} marks add up to {sums[mode]}; they must add up to 100.")
    levels = sorted(body.get("levels") or [], key=lambda l: l["level"])
    prev_s = prev_c = Decimal(-1)
    for l in levels:
        vals = [Decimal(str(l[k])) for k in ("sales_min_pct", "sales_rate", "coll_min_pct", "coll_rate")]
        if any(v < 0 for v in vals):
            raise KpiAdminError("Level percentages and rates cannot be negative.")
        if vals[0] <= prev_s or vals[2] <= prev_c:
            raise KpiAdminError("Each higher level needs a higher 'done' minimum than the one before.")
        prev_s, prev_c = vals[0], vals[2]
    if body.get("level_gap") is not None and int(body["level_gap"]) < 1:
        raise KpiAdminError("Level match gap must be at least 1.")
    grades = body.get("grades") or []
    if grades and len({g["grade"] for g in grades}) != len(grades):
        raise KpiAdminError("Each grade letter can be used once.")


async def preview_rules(s: AsyncSession, effective_from: date) -> dict:
    """How many officers' results would change if rules start on this date."""
    from app.infrastructure.config.company_time import company_today
    today = company_today()
    affected_periods = []
    for kind in ("month", "quarter"):
        p = await ensure_period(s, kind, today)
        if p["status"] == "open" and p["start"] >= effective_from:
            affected_periods.append(kind)
    await s.commit()
    n = (await s.execute(text(
        "SELECT count(*) FROM users WHERE role = 'field_officer' AND is_active AND NOT is_deleted"))).scalar_one()
    return {"officers": int(n) if affected_periods else 0, "periods": affected_periods,
            "note": ("Results of the running period change." if affected_periods else
                     "No running period changes - this applies from the first period that starts on or after this date.")}


async def save_rules(s: AsyncSession, user_id: uuid.UUID, body: dict) -> dict:
    if not body.get("reason"):
        raise KpiAdminError("Please give a reason for this change.")
    eff = date.fromisoformat(str(body["effective_from"]))
    _validate_rules(body)
    old = await get_rules(s, eff)
    if body.get("weights"):
        for w in body["weights"]:
            await s.execute(text("""
                INSERT INTO kpi_weight_set (item_id, weight, cap_pct, effective_from, created_by)
                SELECT id, :w, :c, :e, :u FROM kpi_item WHERE code = :code
                ON CONFLICT (item_id, effective_from) DO UPDATE SET weight = EXCLUDED.weight, cap_pct = EXCLUDED.cap_pct
            """), {"w": Decimal(str(w["weight"])), "c": Decimal(str(w["cap_pct"])), "e": eff, "u": user_id, "code": w["code"]})
    if body.get("levels"):
        gap = int(body.get("level_gap") or 2)
        entry = Decimal(str(body["entry_min_sales_pct"] if body.get("entry_min_sales_pct") is not None else 0.8))
        for l in body["levels"]:
            await s.execute(text("""
                INSERT INTO incentive_rule_set (level, sales_min_pct, sales_rate, coll_min_pct, coll_rate,
                                                entry_min_sales_pct, level_gap, effective_from, created_by)
                VALUES (:l, :a, :b, :c, :d, :en, :g, :e, :u)
                ON CONFLICT (level, effective_from) DO UPDATE SET sales_min_pct = EXCLUDED.sales_min_pct,
                    sales_rate = EXCLUDED.sales_rate, coll_min_pct = EXCLUDED.coll_min_pct,
                    coll_rate = EXCLUDED.coll_rate, entry_min_sales_pct = EXCLUDED.entry_min_sales_pct,
                    level_gap = EXCLUDED.level_gap
            """), {"l": int(l["level"]), "a": Decimal(str(l["sales_min_pct"])), "b": Decimal(str(l["sales_rate"])),
                   "c": Decimal(str(l["coll_min_pct"])), "d": Decimal(str(l["coll_rate"])),
                   "en": entry, "g": gap, "e": eff, "u": user_id})
    if body.get("grades"):
        for g in body["grades"]:
            await s.execute(text("""
                INSERT INTO grade_band (grade, label, min_score, effective_from, created_by)
                VALUES (:g, :l, :m, :e, :u)
                ON CONFLICT (grade, effective_from) DO UPDATE SET label = EXCLUDED.label, min_score = EXCLUDED.min_score
            """), {"g": g["grade"], "l": g["label"], "m": Decimal(str(g["min_score"])), "e": eff, "u": user_id})
    await audit(s, "rules", None, "update",
                {k: old[k] for k in ("weights", "levels", "grades", "entry_min_sales_pct", "level_gap")},
                {k: body.get(k) for k in ("weights", "levels", "grades", "entry_min_sales_pct", "level_gap")}
                | {"effective_from": eff.isoformat()}, body["reason"], user_id)
    await s.commit()
    await _requeue_everyone(s)
    return {"effective_from": eff}


async def save_settings(s: AsyncSession, user_id: uuid.UUID, values: dict, reason: Optional[str]) -> dict:
    allowed = set((await repo.get_settings_map(s)).keys())
    old = {}
    for key, val in values.items():
        if key not in allowed:
            raise KpiAdminError(f"'{key}' is not a KPI setting.")
        old[key] = (await repo.get_settings_map(s)).get(key)
        await s.execute(text("UPDATE settings SET value = CAST(:v AS jsonb), updated_at = now() WHERE key = :k"),
                        {"v": json.dumps(val), "k": key})
    await audit(s, "settings", None, "update", old, values, reason, user_id)
    await s.commit()
    await _requeue_everyone(s)
    return await repo.get_settings_map(s)


async def _requeue_everyone(s: AsyncSession) -> None:
    ids = [r.id for r in (await s.execute(text(
        "SELECT id FROM users WHERE role = 'field_officer' AND is_active AND NOT is_deleted"))).all()]
    await _queue(s, ids)


# ----------------------------------------------------------- sales figures


async def get_sales_figures(s: AsyncSession, year: int, month: int) -> list[dict]:
    rows = (await s.execute(text("""
        SELECT officer_id, sales_amount_paise, collection_amount_paise, source FROM sales_figure
        WHERE year = :y AND month = :m"""), {"y": year, "m": month})).all()
    return [{"officer_id": str(r.officer_id), "sales": r.sales_amount_paise / 100,
             "collection": r.collection_amount_paise / 100, "source": r.source} for r in rows]


async def save_sales_figures(s: AsyncSession, user_id: uuid.UUID, rows: list[dict], source: str,
                             reason: Optional[str]) -> dict:
    changed: set[uuid.UUID] = set()
    for r in rows:
        oid = uuid.UUID(str(r["officer_id"]))
        y, m = int(r["year"]), int(r["month"])
        sales = to_storage("sales_done", r["sales"])
        coll = to_storage("money_collected", r["collection"])
        cur = (await s.execute(text(
            "SELECT id, sales_amount_paise, collection_amount_paise FROM sales_figure "
            "WHERE officer_id = :o AND year = :y AND month = :m"), {"o": oid, "y": y, "m": m})).first()
        if cur and cur.sales_amount_paise == sales and cur.collection_amount_paise == coll:
            continue
        if cur:
            await s.execute(text("""UPDATE sales_figure SET sales_amount_paise = :s, collection_amount_paise = :c,
                source = :src, entered_by = :u, updated_at = now() WHERE id = :id"""),
                            {"s": int(sales), "c": int(coll), "src": source, "u": user_id, "id": cur.id})
            fid, action = cur.id, "update"
            old = {"sales": cur.sales_amount_paise / 100, "collection": cur.collection_amount_paise / 100}
        else:
            fid = (await s.execute(text("""INSERT INTO sales_figure (officer_id, year, month, sales_amount_paise,
                collection_amount_paise, source, entered_by) VALUES (:o, :y, :m, :s, :c, :src, :u) RETURNING id"""),
                                   {"o": oid, "y": y, "m": m, "s": int(sales), "c": int(coll), "src": source, "u": user_id})).scalar_one()
            action, old = "create", None
        await audit(s, "sales_figure", fid, action, old,
                    {"officer_id": str(oid), "year": y, "month": m, "sales": int(sales) / 100,
                     "collection": int(coll) / 100}, reason, user_id)
        changed.add(oid)
    await s.commit()
    await _queue(s, changed)
    return {"changed": len(changed)}


# ---------------------------------------------------------- focus products


async def list_products(s: AsyncSession) -> list[dict]:
    rows = (await s.execute(text(
        "SELECT id, name, sku_code FROM products WHERE is_active = true ORDER BY name"))).all()
    return [{"id": str(r.id), "name": r.name, "sku": r.sku_code} for r in rows]


async def get_focus_plan(s: AsyncSession, on: date) -> dict:
    period = await ensure_period(s, "quarter", on)
    await s.commit()
    rows = (await s.execute(text("""
        SELECT f.id, f.officer_id, f.product_id, p.name AS product, f.expected, f.unit,
               coalesce((
                   SELECT sum(CASE WHEN f.unit = 'units' THEN oi.quantity ELSE oi.quantity * oi.unit_price END)
                   FROM dealer_orders o JOIN order_items oi ON oi.order_id = o.id
                   WHERE o.created_by = f.officer_id AND oi.product_id = f.product_id
                     AND o.status <> ALL(:bad) AND o.order_date::date BETWEEN :s AND :e), 0) AS actual
        FROM focus_product_plan f JOIN products p ON p.id = f.product_id
        WHERE f.period_id = :p ORDER BY p.name
    """), {"p": period["id"], "s": period["start"], "e": period["end"], "bad": list(repo.NOT_AN_ORDER)})).all()
    return {"period": {"start": period["start"], "end": period["end"], "status": period["status"]},
            "rows": [{"id": str(r.id), "officer_id": str(r.officer_id), "product_id": str(r.product_id),
                      "product": r.product, "expected": float(r.expected), "unit": r.unit,
                      "actual": float(r.actual), "done": float(r.actual) >= float(r.expected)} for r in rows]}


async def save_focus_plan(s: AsyncSession, user_id: uuid.UUID, on: date, product_id: uuid.UUID,
                          officer_ids: list[uuid.UUID], expected: Any, unit: str, reason: Optional[str]) -> dict:
    if unit not in ("rupees", "units"):
        raise KpiAdminError("Unit must be rupees or units.")
    exp = Decimal(str(expected))
    if exp < 0:
        raise KpiAdminError("Expected sales cannot be negative.")
    if not officer_ids:
        raise KpiAdminError("Pick at least one officer.")
    period = await ensure_period(s, "quarter", on)
    if period["status"] == "closed":
        raise KpiAdminError("That quarter is closed. Reopen it before changing the plan.")
    if not (await s.execute(text("SELECT 1 FROM products WHERE id = :i AND is_active"), {"i": product_id})).first():
        raise KpiAdminError("Pick the product from the product list.")
    changed = []
    for oid in officer_ids:
        cur = (await s.execute(text(
            "SELECT id, expected, unit FROM focus_product_plan WHERE period_id = :p AND officer_id = :o AND product_id = :pr"),
            {"p": period["id"], "o": oid, "pr": product_id})).first()
        if cur and Decimal(cur.expected) == exp and cur.unit == unit:
            continue
        if cur:
            await s.execute(text("UPDATE focus_product_plan SET expected = :e, unit = :u WHERE id = :id"),
                            {"e": exp, "u": unit, "id": cur.id})
            pid, action, old = cur.id, "update", {"expected": float(cur.expected), "unit": cur.unit}
        else:
            pid = (await s.execute(text("""INSERT INTO focus_product_plan (period_id, officer_id, product_id, expected, unit)
                VALUES (:p, :o, :pr, :e, :u) RETURNING id"""),
                                   {"p": period["id"], "o": oid, "pr": product_id, "e": exp, "u": unit})).scalar_one()
            action, old = "create", None
        await audit(s, "focus_product_plan", pid, action, old,
                    {"officer_id": str(oid), "product_id": str(product_id), "expected": float(exp), "unit": unit,
                     "period_start": period["start"].isoformat()}, reason, user_id)
        changed.append(oid)
    await s.commit()
    await _queue(s, changed)
    return {"changed": len(changed)}


async def delete_focus_plan(s: AsyncSession, user_id: uuid.UUID, plan_id: uuid.UUID, reason: Optional[str]) -> None:
    cur = (await s.execute(text("""
        SELECT f.officer_id, f.product_id, f.expected, f.unit, p.status FROM focus_product_plan f
        JOIN kpi_period p ON p.id = f.period_id WHERE f.id = :i"""), {"i": plan_id})).first()
    if not cur:
        raise KpiAdminError("That plan line no longer exists.")
    if cur.status == "closed":
        raise KpiAdminError("That quarter is closed. Reopen it before changing the plan.")
    await s.execute(text("DELETE FROM focus_product_plan WHERE id = :i"), {"i": plan_id})
    await audit(s, "focus_product_plan", plan_id, "delete",
                {"officer_id": str(cur.officer_id), "product_id": str(cur.product_id),
                 "expected": float(cur.expected), "unit": cur.unit}, None, reason, user_id)
    await s.commit()
    await _queue(s, [cur.officer_id])


# ----------------------------------------------------------------- history


async def history(s: AsyncSession, entity: Optional[str], officer_id: Optional[uuid.UUID], limit: int) -> list[dict]:
    rows = (await s.execute(text("""
        SELECT a.id, a.entity, a.entity_id, a.action, a.old, a.new, a.reason, a.at, u.full_name AS who
        FROM kpi_audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE (CAST(:e AS text) IS NULL OR a.entity = :e)
          AND (CAST(:o AS text) IS NULL OR a.new->>'officer_id' = CAST(:o AS text) OR a.old->>'officer_id' = CAST(:o AS text))
        ORDER BY a.at DESC LIMIT :n
    """), {"e": entity, "o": str(officer_id) if officer_id else None, "n": min(limit, 500)})).all()
    return [{"id": str(r.id), "entity": r.entity, "entity_id": str(r.entity_id) if r.entity_id else None,
             "action": r.action, "old": r.old, "new": r.new, "reason": r.reason, "at": r.at, "by": r.who}
            for r in rows]
