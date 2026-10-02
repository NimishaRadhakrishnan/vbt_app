"""
Shared activity-aggregation queries for the Productivity Rollup and
Momentum routers.

Both features report on the same underlying activity data (task
completion, in particular) but from genuinely different angles:

- Productivity keys task completion off ``due_date`` within an explicit
  ``period_start``/``period_end`` window — "of what was due this period,
  how much got done" — and reports across an arbitrary set of officers
  in one JOIN query (used for both the self view and the admin/manager
  list view, so it has to stay a single bulk query, not one row at a
  time).
- Momentum keys task completion off ``completed_at`` from the start of
  the month with no upper bound — "how much has this person finished
  so far this month, whenever it was due" — feeding a points score and
  a target-hit percentage.

Those two windowing rules produce different numbers by design, so this
service does not collapse them into one generic "count tasks" method —
that would either force Productivity's bulk query into a per-officer
loop (N+1) or silently change one feature's semantics to match the
other's. Instead, each concept gets exactly one implementation, reused
everywhere it's currently needed, so a future edit to (for example) how
"completed" is defined only has to happen once per concept instead of
once per endpoint.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Optional, Sequence

from sqlalchemy import bindparam, text
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncSession

# ---------------------------------------------------------------------------
# Productivity: due_date-windowed, multi-officer activity summary.
# Moved verbatim from productivity_router.py's _SUMMARY_SQL — no query
# logic changed, only relocated and parameterized the same way the router
# was already building it.
# ---------------------------------------------------------------------------
_OFFICER_ACTIVITY_SUMMARY_SQL = """
    SELECT
        u.id AS officer_id,
        u.full_name AS officer_name,
        u.role AS officer_role,

        COALESCE(task_stats.assigned, 0) AS tasks_assigned,
        COALESCE(task_stats.completed, 0) AS tasks_completed,

        COALESCE(attendance_stats.days_present, 0) AS days_present,

        COALESCE(plan_stats.submitted, 0) AS weekly_plans_submitted,
        COALESCE(plan_stats.approved, 0) AS weekly_plans_approved,

        COALESCE(issue_stats.resolved, 0) AS crop_issues_resolved,

        COALESCE(visit_stats.completed, 0) AS visits_completed

    FROM users u

    LEFT JOIN (
        SELECT
            assigned_to,
            COUNT(*) AS assigned,
            COUNT(*) FILTER (WHERE status = 'done') AS completed
        FROM tasks
        WHERE due_date BETWEEN :period_start AND :period_end
        GROUP BY assigned_to
    ) task_stats ON task_stats.assigned_to = u.id

    LEFT JOIN (
        SELECT user_id, COUNT(DISTINCT date) AS days_present
        FROM attendance
        WHERE date BETWEEN :period_start AND :period_end
        GROUP BY user_id
    ) attendance_stats ON attendance_stats.user_id = u.id

    LEFT JOIN (
        SELECT
            user_id,
            COUNT(*) AS submitted,
            COUNT(*) FILTER (WHERE status = 'approved') AS approved
        FROM weekly_plans
        WHERE week_start_date BETWEEN :period_start AND :period_end
        GROUP BY user_id
    ) plan_stats ON plan_stats.user_id = u.id

    LEFT JOIN (
        SELECT user_id, COUNT(*) AS resolved
        FROM crop_issues
        WHERE status = 'resolved' AND updated_at::date BETWEEN :period_start AND :period_end
        GROUP BY user_id
    ) issue_stats ON issue_stats.user_id = u.id

    LEFT JOIN (
        SELECT user_id, COUNT(*) AS completed
        FROM visits
        WHERE start_time::date BETWEEN :period_start AND :period_end
        GROUP BY user_id
    ) visit_stats ON visit_stats.user_id = u.id

    WHERE u.role IN ('field_officer', 'sales_officer', 'manager')
"""

# ---------------------------------------------------------------------------
# Momentum: completed_at-windowed (open-ended), single-officer score +
# monthly count + target. Moved verbatim from momentum_router.py's
# _MOMENTUM_SCORE_SQL / _MONTHLY_COMPLETED_SQL / _MONTHLY_TARGET_SQL,
# which were previously assembled into this same combined SELECT
# independently in both get_my_momentum and get_officer_momentum.
# ---------------------------------------------------------------------------
_MOMENTUM_SCORE_SQL = """
    (
        SELECT COALESCE(SUM(
            CASE WHEN status = 'done' THEN
                CASE WHEN completed_at::date <= due_date THEN
                    CASE WHEN related_type IN ('farmer', 'dealer') AND proof_photo_url IS NULL AND proof_gps_lat IS NULL THEN 6
                    ELSE 10 END
                ELSE 6 END
            ELSE 0 END
        ), 0)
        FROM tasks WHERE assigned_to = u.id
    ) + (
        SELECT COUNT(*) * 5 FROM kudos WHERE to_user_id = u.id
    )
"""

_MONTHLY_COMPLETED_SQL = """
    (
        SELECT COUNT(*) FROM tasks
        WHERE assigned_to = u.id AND status = 'done' AND completed_at >= :start_of_month
    )
"""

_MONTHLY_TARGET_SQL = """
    (
        SELECT monthly_task_target FROM momentum_targets WHERE role = u.role
    )
"""

# Last month's count over the *same number of elapsed days* as this month
# so far (day 1 through :last_month_cutoff), not the full previous month.
# Comparing a partial current month against a complete previous month would
# make the number look artificially low for most of the month regardless
# of actual pace — an apples-to-oranges comparison that would undercut the
# "constructive, no negative framing" goal structurally, not just in
# wording. This keeps the comparison fair.
_PREVIOUS_PERIOD_TO_DATE_COMPLETED_SQL = """
    (
        SELECT COUNT(*) FROM tasks
        WHERE assigned_to = u.id AND status = 'done'
          AND completed_at >= :start_of_last_month AND completed_at < :last_month_cutoff
    )
"""

_MOMENTUM_SUMMARY_SQL = f"""
    SELECT
        {_MOMENTUM_SCORE_SQL} AS momentum_score,
        {_MONTHLY_COMPLETED_SQL} AS monthly_tasks_completed,
        COALESCE({_MONTHLY_TARGET_SQL}, 25) AS monthly_task_target,
        {_PREVIOUS_PERIOD_TO_DATE_COMPLETED_SQL} AS previous_period_tasks_completed
    FROM users u
    WHERE u.id = :officer_id
"""

# Bulk (team-wide) version of the same monthly-completed/target concept,
# used by /momentum/team's hit-rate calculation. Kept as one query (a CTE
# over all matching officers) rather than looping get_momentum_summary
# per officer, to avoid an N+1 the audit already flagged elsewhere.
_MONTHLY_TARGET_HIT_RATE_SQL = f"""
    WITH officer_stats AS (
        SELECT
            u.id,
            {_MONTHLY_COMPLETED_SQL} AS monthly_tasks_completed,
            COALESCE({_MONTHLY_TARGET_SQL}, 25) AS monthly_task_target
        FROM users u
        WHERE u.role NOT IN :exclude_roles
    )
    SELECT
        COUNT(*) FILTER (WHERE monthly_tasks_completed >= monthly_task_target) AS hit_count,
        COUNT(*) AS total_count
    FROM officer_stats
"""


class ActivityAggregationService:
    """Single source of truth for the activity-derived numbers behind the
    Productivity Rollup and Momentum features. See module docstring for
    why the two features' task-completion queries are kept as distinct
    methods rather than unified into one."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_officer_activity_summary(
        self,
        period_start: date,
        period_end: date,
        *,
        user_id: Optional[uuid.UUID] = None,
        manager_id: Optional[uuid.UUID] = None,
        order_by_name: bool = False,
    ) -> Sequence[Row]:
        """Productivity's per-officer rollup (tasks/attendance/plans/crop
        issues/visits) for a due_date-windowed period. Pass ``user_id``
        for a single officer, ``manager_id`` to scope to one manager's
        team, or neither for all matching officers."""
        query = _OFFICER_ACTIVITY_SUMMARY_SQL
        params: dict = {"period_start": period_start, "period_end": period_end}

        if user_id is not None:
            query += " AND u.id = :user_id"
            params["user_id"] = user_id
        if manager_id is not None:
            query += " AND u.manager_id = :manager_id"
            params["manager_id"] = manager_id
        if order_by_name:
            query += " ORDER BY u.full_name ASC"

        result = await self._session.execute(text(query).bindparams(**params))
        return result.all()

    async def get_momentum_summary(
        self,
        user_id: uuid.UUID,
        start_of_month: date,
        start_of_last_month: date,
        last_month_cutoff: date,
    ) -> Optional[Row]:
        """Momentum's per-officer score + month-to-date completed count +
        target + a fair (same-elapsed-days) previous-period comparison
        count, in one query. Used by /momentum/me and
        /momentum/officers/{id} — previously the same combined SELECT
        duplicated verbatim in both endpoints, without any trend data."""
        result = await self._session.execute(
            text(_MOMENTUM_SUMMARY_SQL).bindparams(
                officer_id=user_id,
                start_of_month=start_of_month,
                start_of_last_month=start_of_last_month,
                last_month_cutoff=last_month_cutoff,
            )
        )
        return result.first()

    async def get_monthly_target_hit_rate(
        self, start_of_month: date, exclude_roles: tuple[str, ...] = ("admin",)
    ) -> tuple[int, int]:
        """Team-wide (hit_count, total_count) for /momentum/team's
        percent-hit-target figure — one bulk query, not one per officer."""
        result = await self._session.execute(
            text(_MONTHLY_TARGET_HIT_RATE_SQL).bindparams(
                bindparam("exclude_roles", expanding=True)
            ),
            {"start_of_month": start_of_month, "exclude_roles": list(exclude_roles)},
        )
        row = result.first()
        if not row:
            return 0, 0
        return row.hit_count, row.total_count
