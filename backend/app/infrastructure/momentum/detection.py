"""
Momentum milestone detection hook.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def check_momentum_milestones(
    session: AsyncSession,
    user_id: uuid.UUID,
    related_type: Optional[str],
) -> None:
    """
    Called within the same transaction as a task status update to 'done'.
    Detects if any personal bests were beaten or badges were earned,
    and inserts them along with a notification.
    """
    today = dt.date.today()
    start_of_week = today - dt.timedelta(days=today.weekday())
    end_of_week = start_of_week + dt.timedelta(days=6)

    # 1. Personal Bests
    count_res = await session.execute(
        text("""
            SELECT COUNT(*) FROM tasks
            WHERE assigned_to = :uid
              AND status = 'done'
              AND completed_at >= :sow
              AND completed_at < :eow_plus_1
        """).bindparams(
            uid=user_id,
            sow=dt.datetime.combine(start_of_week, dt.time.min).replace(tzinfo=dt.timezone.utc),
            eow_plus_1=dt.datetime.combine(end_of_week + dt.timedelta(days=1), dt.time.min).replace(tzinfo=dt.timezone.utc)
        )
    )
    current_week_count = count_res.scalar() or 0

    pb_res = await session.execute(
        text("SELECT value FROM personal_bests WHERE user_id = :uid AND metric = 'tasks_per_week'").bindparams(uid=user_id)
    )
    pb_val = pb_res.scalar()

    if pb_val is None or current_week_count > pb_val:
        await session.execute(
            text("""
                INSERT INTO personal_bests (user_id, metric, value, achieved_period_start, achieved_period_end)
                VALUES (:uid, 'tasks_per_week', :val, :sow, :eow)
                ON CONFLICT (user_id, metric) DO UPDATE SET
                    value = EXCLUDED.value,
                    achieved_period_start = EXCLUDED.achieved_period_start,
                    achieved_period_end = EXCLUDED.achieved_period_end,
                    updated_at = now()
            """).bindparams(uid=user_id, val=current_week_count, sow=start_of_week, eow=end_of_week)
        )
        # Only notify if beating an existing PB
        if pb_val is not None:
            await session.execute(
                text("""
                    INSERT INTO notifications (user_id, type, title, message)
                    VALUES (:uid, 'milestone', 'New Personal Best!', 'You beat your personal best for tasks completed in a week!')
                """).bindparams(uid=user_id)
            )

    # 2. Badges
    badges_res = await session.execute(
        text("""
            SELECT b.code, b.metric, b.threshold, b.title
            FROM badges b
            WHERE b.code NOT IN (
                SELECT badge_code FROM user_badges WHERE user_id = :uid
            )
        """).bindparams(uid=user_id)
    )
    unearned_badges = badges_res.all()

    for badge in unearned_badges:
        metric = badge.metric
        count = 0
        
        if metric.startswith("related_type:"):
            target_type = metric.split(":")[1]
            if related_type == target_type:
                c_res = await session.execute(
                    text("SELECT COUNT(*) FROM tasks WHERE assigned_to = :uid AND status = 'done' AND related_type = :tt")
                    .bindparams(uid=user_id, tt=target_type)
                )
                count = c_res.scalar() or 0
        elif metric == "on_time_reports":
            c_res = await session.execute(
                text("SELECT COUNT(*) FROM tasks WHERE assigned_to = :uid AND status = 'done' AND DATE(completed_at) <= due_date")
                .bindparams(uid=user_id)
            )
            count = c_res.scalar() or 0

        if count >= badge.threshold:
            await session.execute(
                text("INSERT INTO user_badges (user_id, badge_code) VALUES (:uid, :code)")
                .bindparams(uid=user_id, code=badge.code)
            )
            await session.execute(
                text("""
                    INSERT INTO notifications (user_id, type, title, message)
                    VALUES (:uid, 'milestone', 'New Badge Earned!', :msg)
                """).bindparams(uid=user_id, msg=f"You earned the '{badge.title}' badge!")
            )
