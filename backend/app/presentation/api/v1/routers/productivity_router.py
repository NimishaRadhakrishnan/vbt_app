"""
Productivity rollup router.

Aggregates real, already-collected data (tasks, attendance, weekly plans,
crop issues, visits) into a daily/weekly/monthly summary per officer —
the "analyse productivity every day, week and month" half of the app's
stated goal. Every number here is computed from real tables at request
time; nothing is stored/cached, so it's always correct and never drifts
from the underlying records.

Two endpoints:
- GET /productivity/me      -> the caller's own summary (any officer)
- GET /productivity         -> admin/manager only; all officers, or one
                               officer via ?officer_id=
"""

from __future__ import annotations

import calendar
import uuid
from datetime import date, timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.engine import Row

from app.application.services.activity_aggregation_service import ActivityAggregationService
from app.core.container import get_activity_aggregation_service
from app.domain.value_objects.role import Role
from app.presentation.api.v1.dependencies import CurrentUser, require_role
from app.presentation.schemas.productivity_schemas import ProductivitySummary

router = APIRouter(prefix="/productivity", tags=["productivity"])

_VALID_PERIODS = {"daily", "weekly", "monthly"}


def _period_bounds(period: str, as_of: date) -> tuple[date, date]:
    if period == "daily":
        return as_of, as_of
    if period == "weekly":
        start = as_of - timedelta(days=as_of.weekday())  # Monday of this week
        return start, start + timedelta(days=6)
    if period == "monthly":
        start = as_of.replace(day=1)
        last_day = calendar.monthrange(as_of.year, as_of.month)[1]
        return start, as_of.replace(day=last_day)
    raise ValueError(f"Unknown period: {period}")


def _row_to_summary(row, period: str, period_start: date, period_end: date, prev_row=None, trend_data=None) -> ProductivitySummary:
    tasks_assigned = row.tasks_assigned
    tasks_completed = row.tasks_completed
    completion_rate = (tasks_completed / tasks_assigned) if tasks_assigned > 0 else None
    
    return ProductivitySummary(
        officer_id=row.officer_id,
        officer_name=row.officer_name,
        officer_role=row.officer_role,
        period=period,
        period_start=period_start,
        period_end=period_end,
        tasks_assigned=tasks_assigned,
        tasks_completed=tasks_completed,
        task_completion_rate=completion_rate,
        days_present=row.days_present,
        weekly_plans_submitted=row.weekly_plans_submitted,
        weekly_plans_approved=row.weekly_plans_approved,
        crop_issues_resolved=row.crop_issues_resolved,
        visits_completed=row.visits_completed,
        
        previous_tasks_completed=prev_row.tasks_completed if prev_row else None,
        previous_days_present=prev_row.days_present if prev_row else None,
        previous_crop_issues_resolved=prev_row.crop_issues_resolved if prev_row else None,
        previous_visits_completed=prev_row.visits_completed if prev_row else None,
        trend_data=trend_data
    )



@router.get("/me", response_model=ProductivitySummary)
async def get_my_productivity(
    current_user: CurrentUser,
    service: Annotated[ActivityAggregationService, Depends(get_activity_aggregation_service)],
    period: str = "weekly",
) -> ProductivitySummary:
    if period not in _VALID_PERIODS:
        raise HTTPException(status_code=400, detail=f"period must be one of {_VALID_PERIODS}")

    today = date.today()
    period_start, period_end = _period_bounds(period, today)
    
    # Calculate previous period bounds
    if period == "daily":
        prev_start = period_start - timedelta(days=1)
        prev_end = period_end - timedelta(days=1)
    elif period == "weekly":
        prev_start = period_start - timedelta(days=7)
        prev_end = period_end - timedelta(days=7)
    else:
        # Monthly - just shift month
        prev_start = period_start.replace(month=period_start.month - 1 if period_start.month > 1 else 12, 
                                          year=period_start.year if period_start.month > 1 else period_start.year - 1)
        last_day = calendar.monthrange(prev_start.year, prev_start.month)[1]
        prev_end = prev_start.replace(day=last_day)

    rows = await service.get_officer_activity_summary(
        period_start, period_end, user_id=current_user.user_id
    )
    row = rows[0] if rows else None
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No productivity data available for this account's role.")

    prev_rows = await service.get_officer_activity_summary(
        prev_start, prev_end, user_id=current_user.user_id
    )
    prev_row = prev_rows[0] if prev_rows else None
    
    # Calculate trend data (last 7 periods)
    trend_data = []
    # For daily, last 7 days. For weekly/monthly, last 7 weeks.
    trend_period = "weekly" if period in ("weekly", "monthly") else "daily"
    
    for i in range(6, -1, -1):
        if trend_period == "daily":
            t_start = today - timedelta(days=i)
            t_end = t_start
            label = t_start.strftime("%a")
        else:
            t_start = today - timedelta(days=today.weekday() + (i * 7))
            t_end = t_start + timedelta(days=6)
            label = f"W{t_start.isocalendar()[1]}"

        t_rows = await service.get_officer_activity_summary(
            t_start, t_end, user_id=current_user.user_id
        )
        t_row = t_rows[0] if t_rows else None
        trend_data.append({
            "label": label,
            "tasks": t_row.tasks_completed if t_row else 0,
            "visits": t_row.visits_completed if t_row else 0
        })

    return _row_to_summary(row, period, period_start, period_end, prev_row, trend_data)


@router.get("", response_model=list[ProductivitySummary])
async def list_productivity(
    _current_user: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    service: Annotated[ActivityAggregationService, Depends(get_activity_aggregation_service)],
    period: str = "weekly",
    officer_id: Optional[uuid.UUID] = None,
    manager_id: Optional[uuid.UUID] = None,
) -> list[ProductivitySummary]:
    if period not in _VALID_PERIODS:
        raise HTTPException(status_code=400, detail=f"period must be one of {_VALID_PERIODS}")

    period_start, period_end = _period_bounds(period, date.today())

    # Enforce manager role filter if they are a manager
    effective_manager_id: Optional[uuid.UUID] = None
    if getattr(_current_user, "role", None) == "manager":
        effective_manager_id = _current_user.user_id
    elif manager_id:
        effective_manager_id = manager_id

    rows = await service.get_officer_activity_summary(
        period_start,
        period_end,
        user_id=officer_id,
        manager_id=effective_manager_id,
        order_by_name=True,
    )
    return [_row_to_summary(row, period, period_start, period_end) for row in rows]
