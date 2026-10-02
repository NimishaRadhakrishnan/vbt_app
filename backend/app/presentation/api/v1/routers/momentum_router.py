"""
Momentum endpoints (v2, raw-SQL).
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.services.activity_aggregation_service import ActivityAggregationService
from app.core.container import get_activity_aggregation_service
from app.domain.value_objects.role import Role
from app.infrastructure.database.session import get_db_session
from app.presentation.api.v1.dependencies import CurrentUser, require_role
from app.presentation.schemas.momentum_schemas import (
    BadgeResponse,
    KudosCreateRequest,
    KudosResponse,
    MomentumMeResponse,
    MomentumTargetResponse,
    MomentumTargetUpdateRequest,
    MomentumTeamResponse,
    PersonalBestResponse,
)

router = APIRouter(prefix="/momentum", tags=["momentum"])


def _get_start_of_month(today: dt.date) -> dt.date:
    return today.replace(day=1)


def _get_start_of_week(today: dt.date) -> dt.date:
    return today - dt.timedelta(days=today.weekday())


def _get_previous_period_window(today: dt.date, start_of_month: dt.date) -> tuple[dt.date, dt.date]:
    """Start of last month, and the cutoff date that gives last month the
    same number of elapsed days as this month has had so far (day 1
    through today) — so the two counts are comparing like with like."""
    days_elapsed = (today - start_of_month).days + 1
    last_month_end = start_of_month - dt.timedelta(days=1)
    start_of_last_month = last_month_end.replace(day=1)
    last_month_cutoff = min(start_of_last_month + dt.timedelta(days=days_elapsed), start_of_month)
    return start_of_last_month, last_month_cutoff


def _build_trend(previous: int, current: int) -> tuple[str, str]:
    """Constructive period-over-period wording (brief §9): personal trend
    only, never a ranking; no negative framing when the count is lower —
    'building' rather than 'down', with no percentage attached to it."""
    if previous == 0 and current == 0:
        return "steady", "No completed tasks yet this period — a fresh start."
    if previous == 0:
        return "up", f"{current} completed so far this month — off to a strong start!"
    if current > previous:
        pct = round((current - previous) / previous * 100)
        return "up", f"Last Month: {previous} → This Month: {current}, +{pct}%"
    if current == previous:
        return "steady", f"Matching last month's pace — {current} completed at this point, same as last month."
    return "building", f"{current} completed so far this month (last month at this point: {previous}) — plenty of the month still ahead."


@router.get("/me", response_model=MomentumMeResponse)
async def get_my_momentum(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    service: Annotated[ActivityAggregationService, Depends(get_activity_aggregation_service)],
) -> MomentumMeResponse:
    today = dt.date.today()
    start_of_month = _get_start_of_month(today)
    start_of_last_month, last_month_cutoff = _get_previous_period_window(today, start_of_month)

    # 1. Fetch score, monthly completed count, target, and trend comparison
    score_row = await service.get_momentum_summary(
        current_user.user_id, start_of_month, start_of_last_month, last_month_cutoff
    )
    if not score_row:
        raise HTTPException(status_code=404, detail="User not found")
    trend_direction, trend_label = _build_trend(
        score_row.previous_period_tasks_completed, score_row.monthly_tasks_completed
    )

    # 2. Fetch badges
    badges_res = await session.execute(
        text("""
            SELECT b.code, b.title, b.description, b.metric, b.threshold, ub.earned_at
            FROM user_badges ub
            JOIN badges b ON ub.badge_code = b.code
            WHERE ub.user_id = :officer_id
            ORDER BY ub.earned_at DESC
        """).bindparams(officer_id=current_user.user_id)
    )
    badges = [
        BadgeResponse(
            code=r.code, title=r.title, description=r.description, metric=r.metric, threshold=r.threshold, earned_at=r.earned_at
        ) for r in badges_res.all()
    ]

    # 3. Fetch personal bests
    pbs_res = await session.execute(
        text("""
            SELECT metric, value, achieved_period_start, achieved_period_end
            FROM personal_bests
            WHERE user_id = :officer_id
        """).bindparams(officer_id=current_user.user_id)
    )
    pbs = [
        PersonalBestResponse(
            metric=r.metric, value=r.value, achieved_period_start=r.achieved_period_start, achieved_period_end=r.achieved_period_end
        ) for r in pbs_res.all()
    ]

    # 4. Fetch recent kudos
    kudos_res = await session.execute(
        text("""
            SELECT k.id, k.from_user_id, u.full_name as from_user_name, k.to_user_id, k.task_id, k.message, k.created_at
            FROM kudos k
            JOIN users u ON k.from_user_id = u.id
            WHERE k.to_user_id = :officer_id
            ORDER BY k.created_at DESC
            LIMIT 5
        """).bindparams(officer_id=current_user.user_id)
    )
    recent_kudos = [
        KudosResponse(
            id=r.id, from_user_id=r.from_user_id, from_user_name=r.from_user_name, to_user_id=r.to_user_id,
            task_id=r.task_id, message=r.message, created_at=r.created_at
        ) for r in kudos_res.all()
    ]

    return MomentumMeResponse(
        momentum_score=score_row.momentum_score,
        monthly_tasks_completed=score_row.monthly_tasks_completed,
        monthly_task_target=score_row.monthly_task_target,
        personal_bests=pbs,
        badges=badges,
        recent_kudos=recent_kudos,
        previous_period_tasks_completed=score_row.previous_period_tasks_completed,
        trend_direction=trend_direction,
        trend_label=trend_label,
    )


@router.get("/team", response_model=MomentumTeamResponse)
async def get_team_momentum(
    current_user: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    service: Annotated[ActivityAggregationService, Depends(get_activity_aggregation_service)],
) -> MomentumTeamResponse:
    today = dt.date.today()
    start_of_month = _get_start_of_month(today)
    start_of_week = _get_start_of_week(today)

    # 1. Percent of officers who hit their monthly target so far
    hit_count, total_count = await service.get_monthly_target_hit_rate(start_of_month)
    percent_hit = 0.0
    if total_count > 0:
        percent_hit = (hit_count / total_count) * 100.0

    # 2. Total badges earned team-wide this month
    badges_res = await session.execute(
        text("SELECT COUNT(*) FROM user_badges WHERE earned_at >= :som").bindparams(som=start_of_month)
    )
    badges_earned = badges_res.scalar() or 0

    # 3. Personal bests beaten this week
    pb_res = await session.execute(
        text("SELECT COUNT(DISTINCT user_id) FROM personal_bests WHERE achieved_period_start = :sow").bindparams(sow=start_of_week)
    )
    pbs_this_week = pb_res.scalar() or 0

    return MomentumTeamResponse(
        percent_hit_target=percent_hit,
        team_badges_this_month=badges_earned,
        personal_bests_this_week=pbs_this_week
    )


@router.get("/officers/{user_id}", response_model=MomentumMeResponse)
async def get_officer_momentum(
    user_id: uuid.UUID,
    current_user: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    service: Annotated[ActivityAggregationService, Depends(get_activity_aggregation_service)],
) -> MomentumMeResponse:
    today = dt.date.today()
    start_of_month = _get_start_of_month(today)
    start_of_last_month, last_month_cutoff = _get_previous_period_window(today, start_of_month)

    score_row = await service.get_momentum_summary(
        user_id, start_of_month, start_of_last_month, last_month_cutoff
    )
    if not score_row:
        raise HTTPException(status_code=404, detail="Officer not found")
    trend_direction, trend_label = _build_trend(
        score_row.previous_period_tasks_completed, score_row.monthly_tasks_completed
    )

    badges_res = await session.execute(
        text("""
            SELECT b.code, b.title, b.description, b.metric, b.threshold, ub.earned_at
            FROM user_badges ub
            JOIN badges b ON ub.badge_code = b.code
            WHERE ub.user_id = :officer_id
            ORDER BY ub.earned_at DESC
        """).bindparams(officer_id=user_id)
    )
    badges = [
        BadgeResponse(
            code=r.code, title=r.title, description=r.description, metric=r.metric, threshold=r.threshold, earned_at=r.earned_at
        ) for r in badges_res.all()
    ]

    pbs_res = await session.execute(
        text("""
            SELECT metric, value, achieved_period_start, achieved_period_end
            FROM personal_bests
            WHERE user_id = :officer_id
        """).bindparams(officer_id=user_id)
    )
    pbs = [
        PersonalBestResponse(
            metric=r.metric, value=r.value, achieved_period_start=r.achieved_period_start, achieved_period_end=r.achieved_period_end
        ) for r in pbs_res.all()
    ]

    kudos_res = await session.execute(
        text("""
            SELECT k.id, k.from_user_id, u.full_name as from_user_name, k.to_user_id, k.task_id, k.message, k.created_at
            FROM kudos k
            JOIN users u ON k.from_user_id = u.id
            WHERE k.to_user_id = :officer_id
            ORDER BY k.created_at DESC
            LIMIT 5
        """).bindparams(officer_id=user_id)
    )
    recent_kudos = [
        KudosResponse(
            id=r.id, from_user_id=r.from_user_id, from_user_name=r.from_user_name, to_user_id=r.to_user_id,
            task_id=r.task_id, message=r.message, created_at=r.created_at
        ) for r in kudos_res.all()
    ]

    return MomentumMeResponse(
        momentum_score=score_row.momentum_score,
        monthly_tasks_completed=score_row.monthly_tasks_completed,
        monthly_task_target=score_row.monthly_task_target,
        personal_bests=pbs,
        badges=badges,
        recent_kudos=recent_kudos,
        previous_period_tasks_completed=score_row.previous_period_tasks_completed,
        trend_direction=trend_direction,
        trend_label=trend_label,
    )


@router.get("/badges", response_model=List[BadgeResponse])
async def list_badges(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> List[BadgeResponse]:
    res = await session.execute(text("SELECT code, title, description, metric, threshold FROM badges"))
    return [
        BadgeResponse(
            code=r.code, title=r.title, description=r.description, metric=r.metric, threshold=r.threshold
        ) for r in res.all()
    ]


@router.get("/targets", response_model=List[MomentumTargetResponse])
async def list_targets(
    current_user: Annotated[object, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> List[MomentumTargetResponse]:
    res = await session.execute(text("SELECT role, monthly_task_target, updated_at FROM momentum_targets"))
    return [
        MomentumTargetResponse(
            role=r.role, monthly_task_target=r.monthly_task_target, updated_at=r.updated_at
        ) for r in res.all()
    ]


@router.put("/targets/{role}", response_model=MomentumTargetResponse)
async def update_target(
    role: str,
    payload: MomentumTargetUpdateRequest,
    current_user: Annotated[object, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> MomentumTargetResponse:
    res = await session.execute(
        text("""
            INSERT INTO momentum_targets (role, monthly_task_target)
            VALUES (:role, :target)
            ON CONFLICT (role) DO UPDATE SET 
                monthly_task_target = EXCLUDED.monthly_task_target,
                updated_at = now()
            RETURNING role, monthly_task_target, updated_at
        """).bindparams(role=role, target=payload.monthly_task_target)
    )
    row = res.first()
    await session.commit()
    return MomentumTargetResponse(
        role=row.role, monthly_task_target=row.monthly_task_target, updated_at=row.updated_at
    )


@router.post("/kudos", response_model=KudosResponse, status_code=status.HTTP_201_CREATED)
async def give_kudos(
    payload: KudosCreateRequest,
    current_user: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> KudosResponse:
    res = await session.execute(
        text("""
            INSERT INTO kudos (from_user_id, to_user_id, task_id, message)
            VALUES (:from_id, :to_id, :task_id, :msg)
            RETURNING id, from_user_id, to_user_id, task_id, message, created_at
        """).bindparams(
            from_id=current_user.user_id, to_id=payload.to_user_id, task_id=payload.task_id, msg=payload.message
        )
    )
    row = res.first()
    
    await session.execute(
        text("""
            INSERT INTO notifications (user_id, type, title, message)
            VALUES (:to_id, 'broadcast', 'You received Appreciation!', :msg)
        """).bindparams(
            to_id=payload.to_user_id,
            msg=f"A manager sent you appreciation: {payload.message}" if payload.message else "A manager sent you appreciation!"
        )
    )
    
    await session.commit()

    return KudosResponse(
        id=row.id,
        from_user_id=row.from_user_id,
        from_user_name=None,
        to_user_id=row.to_user_id,
        task_id=row.task_id,
        message=row.message,
        created_at=row.created_at
    )


# ---------------------------------------------------------------------------
# Quarterly / annual-target-derived rollup (section 2: dashboard widget's
# "3 months" view). Reads the annual_targets + monthly_target_weights
# tables that admin_router.py's annual-target endpoints write to - one
# target mechanism, consumed here for the task-completion metric and again
# by visit_router.kpi_summary for the visit-KPI metric.
# ---------------------------------------------------------------------------

async def _monthly_weight(session: AsyncSession, role: str, metric: str, month: int) -> float:
    result = await session.execute(
        text("SELECT weight FROM monthly_target_weights WHERE role = :role AND metric = :metric AND month = :month")
        .bindparams(role=role, metric=metric, month=month)
    )
    row = result.first()
    if row:
        return float(row.weight)
    return 1 / 12  # No admin-defined weighting yet - even split, same fallback as admin_router's GET.


async def _annual_target(session: AsyncSession, role: str, metric: str, year: int) -> float:
    result = await session.execute(
        text("SELECT annual_value FROM annual_targets WHERE role = :role AND metric = :metric AND year = :year")
        .bindparams(role=role, metric=metric, year=year)
    )
    row = result.first()
    return float(row.annual_value) if row else 0.0


@router.get("/quarterly")
async def get_quarterly_momentum(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    metric: str = "tasks_completed",
) -> dict:
    """Current month + trailing 2 months: actual (from the existing tasks
    rollup) vs. target (annual_target x that month's weight). Falls back
    to an even 12-way split and a 0 target if admin hasn't configured
    annual_targets yet, so the widget always has something to render
    instead of erroring."""
    today = dt.date.today()
    months: list[dict] = []
    total_actual = 0
    total_target = 0.0

    for i in range(2, -1, -1):  # oldest of the 3 first
        year = today.year
        month = today.month - i
        while month <= 0:
            month += 12
            year -= 1

        target = await _annual_target(session, current_user.role, metric, year)
        weight = await _monthly_weight(session, current_user.role, metric, month)
        month_target = round(target * weight, 2)

        month_start = dt.date(year, month, 1)
        next_month = dt.date(year + (1 if month == 12 else 0), 1 if month == 12 else month + 1, 1)
        result = await session.execute(
            text(
                """
                SELECT COUNT(*) FROM tasks
                WHERE assigned_to = :user_id AND status = 'done'
                AND completed_at >= :month_start AND completed_at < :next_month
                """
            ).bindparams(user_id=current_user.user_id, month_start=month_start, next_month=next_month)
        )
        actual = result.scalar() or 0

        months.append({"year": year, "month": month, "actual": actual, "target": month_target})
        total_actual += actual
        total_target += month_target

    return {
        "metric": metric,
        "months": months,
        "quarter_actual": total_actual,
        "quarter_target": round(total_target, 2),
    }
