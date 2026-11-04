"""
Friendly goal reminders (phase 6). At most ONE per officer per day, and the
admin can switch them all off (setting kpi.nudges_enabled).

Candidates, most useful first: a goal reached (100%), close to the next
incentive level (within 10%), 80% and 50% of a goal, 7 days left in the
month, and on Monday how many visits the week needs. Each one is sent once
(nudge_key is unique per officer). The message is saved as an in-app
notification and, when the officer's phone has registered for pushes, also
sent as a push. Tone is always encouraging.
"""

from __future__ import annotations

import math
import uuid
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.use_cases import kpi_overview as ov
from app.application.use_cases import kpi_recalculate as eng
from app.infrastructure.config.company_time import company_today, is_weekly_working_day
from app.infrastructure.push.expo_push import send_push
from app.infrastructure.repositories import kpi_data_repository as repo

TITLE = "My Goals"
MILESTONES = (100, 80, 50)


def _works_left_in_week(today: date, holidays: set[date]) -> int:
    n, d = 0, today
    while d.weekday() <= 5 and d.isocalendar()[1] == today.isocalendar()[1]:
        if is_weekly_working_day(d) and d not in holidays:
            n += 1
        d += timedelta(days=1)
        if d.weekday() == 0:
            break
    return n


def candidates(data: dict, today: date, holidays: set[date]) -> list[tuple[str, str, str]]:
    """(kind, key, message) in priority order. `data` is kpi_overview.overview()."""
    out: list[tuple[str, str, str]] = []
    period = data["period"]
    pkey = str(period["start"])
    items = [i for blk in ("field", "sales") for i in (data.get(blk) or {}).get("items", [])
             if not i["skipped"] and i["goal"] > 0 and i["pct"] is not None]
    for ms in (100,):
        for i in items:
            if i["pct"] * 100 >= ms:
                out.append(("milestone", f"ms:{i['code']}:{ms}:{pkey}", f"You reached 100% of \"{i['name']}\". Well done!"))
    sales = data.get("sales") or {}
    wi = sales.get("what_if") or {}
    if sales and not sales.get("waiting_for_figures"):
        sg, cg = sales["sales_goal_paise"], sales["collection_goal_paise"]
        if wi.get("collection_needed_paise") and cg and wi["collection_needed_paise"] <= 0.10 * cg and wi.get("next_collection_level"):
            out.append(("level", f"lvl:c{wi['next_collection_level']}:{pkey}", f"You are close. {wi['message']}" if wi.get("message") else "You are close to the next collection level."))
        elif wi.get("sales_needed_paise") and sg and wi["sales_needed_paise"] <= 0.10 * sg and wi.get("next_sales_level"):
            out.append(("level", f"lvl:s{wi['next_sales_level']}:{pkey}", f"You are close. Sell {ov._rupee(wi['sales_needed_paise'])} more to reach Level {wi['next_sales_level']}."))
    for ms in (80, 50):
        for i in items:
            if i["pct"] * 100 >= ms and i["pct"] < 1:
                out.append(("milestone", f"ms:{i['code']}:{ms}:{pkey}", f"You are past {ms}% of \"{i['name']}\". Keep going!"))
                break
    if period["days_left"] == 7 and period["type"] == "month":
        out.append(("days_left", f"d7:{pkey}", f"7 days left this month. {data['advice']}"))
    if today.weekday() == 0 and data.get("field"):
        v = next((i for i in data["field"]["items"] if i["code"] == "farmers_visited" and not i["skipped"] and i["goal"] > 0), None)
        if v and v["left"] > 0 and period["working_days_left"] > 0:
            per_day = v["left"] / period["working_days_left"]
            need = max(1, math.ceil(per_day * _works_left_in_week(today, holidays)))
            out.append(("weekly", f"wk:{today.isoformat()}", f"This week you need {need} farmer visit{'s' if need != 1 else ''} to stay on track."))
    return out


async def _already_today(s: AsyncSession, officer_id: uuid.UUID, today: date) -> bool:
    return (await s.execute(text("SELECT 1 FROM kpi_nudge_log WHERE officer_id = :o AND sent_on = :d AND delivered"),
                            {"o": officer_id, "d": today})).first() is not None


async def nudge_officer(s: AsyncSession, officer_id: uuid.UUID, today: Optional[date] = None) -> Optional[str]:
    """Send at most one nudge today. Returns the message sent, or None."""
    today = today or company_today()
    if not is_weekly_working_day(today) or await _already_today(s, officer_id, today):
        return None
    holidays = {r.date for r in (await s.execute(text("SELECT date FROM holiday_calendar WHERE date BETWEEN :a AND :b"),
                                                 {"a": today, "b": today + timedelta(days=7)})).all()}
    if today in holidays:
        return None
    on_leave = (await s.execute(text("SELECT 1 FROM leave_requests WHERE officer_id = :o AND status = 'approved' AND is_deleted = false "
                                     "AND :d BETWEEN start_date AND end_date"), {"o": officer_id, "d": today})).first()
    if on_leave:
        return None
    data = await ov.overview(s, officer_id, "month")
    if not data.get("ready"):
        return None
    sent = {r.nudge_key for r in (await s.execute(text("SELECT nudge_key FROM kpi_nudge_log WHERE officer_id = :o"), {"o": officer_id})).all()}
    chosen = next(((k, key, msg) for k, key, msg in candidates(data, today, holidays) if key not in sent), None)
    if chosen is None:
        return None
    kind, key, msg = chosen
    # a higher milestone makes the lower ones for the same goal stale: record them as done, silently
    if key.startswith("ms:"):
        _, code, ms, pkey = key.split(":")
        for lower in (m for m in MILESTONES if m < int(ms)):
            await s.execute(text("INSERT INTO kpi_nudge_log (officer_id, kind, nudge_key, delivered, sent_on) "
                                 "VALUES (:o, 'milestone', :k, false, :d) ON CONFLICT DO NOTHING"),
                            {"o": officer_id, "k": f"ms:{code}:{lower}:{pkey}", "d": today})
    ins = await s.execute(text("INSERT INTO kpi_nudge_log (officer_id, kind, nudge_key, sent_on) VALUES (:o, :kind, :k, :d) "
                               "ON CONFLICT DO NOTHING RETURNING id"), {"o": officer_id, "kind": kind, "k": key, "d": today})
    if ins.first() is None:
        return None
    await s.execute(text("INSERT INTO notifications (id, user_id, title, message, type, is_read) "
                         "VALUES (gen_random_uuid(), :u, :t, :m, 'kpi_nudge', false)"), {"u": officer_id, "t": TITLE, "m": msg})
    tokens = [r.token for r in (await s.execute(text("SELECT token FROM push_token WHERE user_id = :u"), {"u": officer_id})).all()]
    await s.commit()
    await send_push(tokens, TITLE, msg)
    return msg


async def nudge_everyone(s: AsyncSession) -> tuple[int, int]:
    """Daily run. Returns (nudges sent, officers that failed)."""
    if (await repo.get_settings_map(s)).get("kpi.nudges_enabled") is not True:
        return 0, 0
    ids = [r.id for r in (await s.execute(text(
        "SELECT id FROM users WHERE role = 'field_officer' AND is_active = true AND is_deleted = false"))).all()]
    sent = failed = 0
    for oid in ids:
        try:
            if await nudge_officer(s, oid):
                sent += 1
        except Exception:  # noqa: BLE001 - one officer must not stop the rest
            await s.rollback()
            failed += 1
    return sent, failed


async def latest_unread(s: AsyncSession, officer_id: uuid.UUID) -> Optional[dict]:
    r = (await s.execute(text("SELECT id, message, created_at FROM notifications WHERE user_id = :u AND type = 'kpi_nudge' "
                              "AND is_read = false AND created_at > now() - interval '2 days' ORDER BY created_at DESC LIMIT 1"),
                         {"u": officer_id})).first()
    return None if r is None else {"id": str(r.id), "message": r.message}


async def register_token(s: AsyncSession, user_id: uuid.UUID, token: str, platform: Optional[str]) -> None:
    await s.execute(text("INSERT INTO push_token (user_id, token, platform) VALUES (:u, :t, :p) "
                         "ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform"),
                    {"u": user_id, "t": token[:200], "p": platform})
    await s.commit()
