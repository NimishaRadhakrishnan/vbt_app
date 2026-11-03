"""
Redis job queue for KPI recalculation.

Any change that can move an officer's numbers (a visit, a trial, an order,
a day closure, a leave decision, a goal or rule change) calls
enqueue_officer(). That only adds the officer to a Redis set - cheap and
never fails the caller's request. A worker loop in the backend drains the
set about every 30 seconds, so a screen is up to date within a minute, and
the same officer changing ten times costs one recalculation.

If the officer reports to a manager, the manager is queued too (their
"FO follow-up" score is the average of the officers under them).
"""

from __future__ import annotations

import logging
import uuid
from datetime import date
from typing import Optional

from sqlalchemy import text

from app.infrastructure.cache.redis_client import get_redis_client
from app.infrastructure.config.company_time import company_today

logger = logging.getLogger("kpi.queue")
QUEUE_KEY = "kpi:dirty"


async def enqueue_officer(officer_id: uuid.UUID | str, on: Optional[date] = None, manager_id: Optional[uuid.UUID | str] = None) -> None:
    """Best effort: a queue problem must never break the entry being saved."""
    try:
        day = (on or company_today()).isoformat()
        r = get_redis_client()
        members = [f"{officer_id}:{day}"]
        if manager_id:
            members.append(f"{manager_id}:{day}")
        await r.sadd(QUEUE_KEY, *members)
    except Exception:
        logger.warning("kpi_enqueue_failed officer=%s", officer_id, exc_info=True)


async def enqueue_with_manager(session, officer_id: uuid.UUID | str, on: Optional[date] = None) -> None:
    """Queue the officer and, if they have one, their manager."""
    try:
        row = (await session.execute(text("SELECT manager_id FROM users WHERE id = :i"), {"i": officer_id})).first()
        await enqueue_officer(officer_id, on, row.manager_id if row else None)
    except Exception:
        logger.warning("kpi_enqueue_failed officer=%s", officer_id, exc_info=True)


async def drain_once(limit: int = 200) -> int:
    """Recalculate everything currently queued. Returns how many officers were done."""
    from app.application.use_cases.kpi_recalculate import recalculate_for_date
    from app.infrastructure.database.session import AsyncSessionLocal

    r = get_redis_client()
    done = 0
    for _ in range(limit):
        member = await r.spop(QUEUE_KEY)
        if not member:
            break
        try:
            oid, day = member.split(":", 1)
            async with AsyncSessionLocal() as s:
                await recalculate_for_date(s, uuid.UUID(oid), date.fromisoformat(day))
                await s.commit()
            done += 1
        except Exception:
            # not re-queued: a bad job must not block the rest, and the
            # nightly full run recalculates everyone anyway
            logger.exception("kpi_job_failed member=%s", member)
    return done
