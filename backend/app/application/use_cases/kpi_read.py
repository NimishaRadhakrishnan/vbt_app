"""
Read side of the KPI module: who may see whose numbers, and the latest
saved snapshot. The router stays thin (no SQL in routers).
"""

from __future__ import annotations

import uuid

from sqlalchemy import text

from app.application.use_cases.kpi_recalculate import ensure_period, recalculate_for_date
from app.infrastructure.config.company_time import company_today
from app.infrastructure.database.session import AsyncSessionLocal


async def can_view(session, viewer, officer_id: uuid.UUID) -> bool:
    if viewer.role == "admin":
        return True
    if str(viewer.user_id) == str(officer_id):
        return True
    if viewer.role == "manager":
        r = await session.execute(text("SELECT 1 FROM users WHERE id = :o AND manager_id = :m"),
                                  {"o": officer_id, "m": viewer.user_id})
        return r.first() is not None
    return False


async def latest_snapshot(officer_id: uuid.UUID, kind: str, refresh: bool) -> dict:
    async with AsyncSessionLocal() as s:
        period = await ensure_period(s, kind, company_today())
        if refresh:
            await recalculate_for_date(s, officer_id)
            await s.commit()
        row = (await s.execute(text("""
            SELECT snapshot_date, items, score, grade, sales_level, collection_level, level_match_applied,
                   sales_incentive_paise, collection_incentive_paise, final_incentive_paise,
                   waiting_for_figures, calculated_at
            FROM performance_snapshot WHERE officer_id = :o AND period_id = :p
            ORDER BY snapshot_date DESC LIMIT 1
        """), {"o": officer_id, "p": period["id"]})).first()
    return {
        "period": {"type": kind, "start": period["start"], "end": period["end"], "status": period["status"]},
        "snapshot": None if row is None else {
            "date": row.snapshot_date, "details": row.items, "score": float(row.score) if row.score is not None else None,
            "grade": row.grade, "sales_level": row.sales_level, "collection_level": row.collection_level,
            "level_match_applied": row.level_match_applied,
            "final_incentive_paise": row.final_incentive_paise,
            "waiting_for_figures": row.waiting_for_figures, "calculated_at": row.calculated_at,
        },
    }
