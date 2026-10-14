"""
Weekly Planning Router endpoints.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Optional, Annotated

from fastapi import APIRouter, Depends, status, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.use_cases.planning_use_case import PlanningUseCase
from app.core.container import get_planning_use_case, get_notification_repository
from app.domain.repositories.notification_repository import NotificationRepository
from app.domain.entities.notification import Notification
from app.infrastructure.database.session import get_db_session
from app.presentation.api.v1.dependencies import CurrentUser
from app.presentation.schemas.planning_schemas import (
    PlanApproveRequest,
    PlanDeviationRequest,
    WeeklyPlanResponse,
    WeeklyPlanSubmitRequest,
)

router = APIRouter(prefix="/plans", tags=["plans"])


@router.get("/my-territories")
async def get_my_territories(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[dict]:
    """The officer's own assigned territories - added because nothing
    exposed this anywhere before (user_management_router.py only lets an
    Admin ASSIGN territory_ids, there was no way for the officer
    themselves to read their own assignment back). The mobile Weekly Plan
    screen needs this: it was previously submitting every plan with a
    single hardcoded fake territory_id, so every officer's schedule was
    silently filed under the wrong territory regardless of where they
    actually work."""
    result = await session.execute(
        text("""
            SELECT t.id, t.name, t.district, t.taluk, t.village
            FROM user_territories ut
            JOIN territories t ON t.id = ut.territory_id
            WHERE ut.user_id = :user_id
            ORDER BY t.name
        """).bindparams(user_id=current_user.user_id)
    )
    rows = result.all()
    if not rows:
        # Nothing assigned by an admin: offer one territory per admin-managed
        # district (created on first use) so officers are never blocked from
        # planning their week.
        names = await session.execute(text("SELECT name FROM districts ORDER BY sort_order, name"))
        for (dname,) in names.all():
            exists = await session.execute(
                text("SELECT 1 FROM territories WHERE lower(name) = lower(:n) AND lower(district) = lower(:n)"), {"n": dname}
            )
            if not exists.first():
                await session.execute(
                    text("INSERT INTO territories (id, name, district) VALUES (:id, :n, :n)"), {"id": uuid.uuid4(), "n": dname}
                )
        await session.commit()
        result = await session.execute(
            text("""
                SELECT t.id, t.name, t.district, t.taluk, t.village FROM territories t
                JOIN districts d ON lower(d.name) = lower(t.district) AND lower(t.name) = lower(t.district)
                ORDER BY d.sort_order, t.name
            """)
        )
        rows = result.all()
    return [
        {"id": str(row.id), "name": row.name, "district": row.district, "taluk": row.taluk, "village": row.village}
        for row in rows
    ]


@router.post("/submit", response_model=WeeklyPlanResponse, status_code=status.HTTP_201_CREATED)
async def submit_weekly_plan(
    payload: WeeklyPlanSubmitRequest,
    current_user: CurrentUser,
    use_case: Annotated[PlanningUseCase, Depends(get_planning_use_case)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> WeeklyPlanResponse:
    start = payload.week_start_date
    end = payload.end_date
    summary = (payload.summary or "").strip() or None
    if payload.activities:
        end = end or max(a.date for a in payload.activities)
    else:
        if end is None:
            raise HTTPException(status_code=400, detail="Choose the plan's end date.")
        if not summary or len(summary) < 3:
            raise HTTPException(status_code=400, detail="Add a short description of the planned work.")
        if payload.territory_id is None:
            raise HTTPException(status_code=400, detail="Choose a territory / district.")
    if end < start:
        raise HTTPException(status_code=400, detail="End date cannot be before the start date.")
    if (end - start).days > 30:
        raise HTTPException(status_code=400, detail="A plan can cover at most 31 days.")

    # No two live plans for the same officer may overlap in dates.
    clash = await session.execute(
        text("""
            SELECT week_start_date, COALESCE(end_date, week_start_date + 6) AS e, status
            FROM weekly_plans
            WHERE user_id = :uid AND is_deleted = false AND status IN ('pending', 'approved')
              AND week_start_date <= :end AND COALESCE(end_date, week_start_date + 6) >= :start
            LIMIT 1
        """),
        {"uid": current_user.user_id, "start": start, "end": end},
    )
    row = clash.first()
    if row:
        raise HTTPException(
            status_code=409,
            detail=f"You already have a {row.status} plan from {row.week_start_date} to {row.e}. Pick dates outside that period.",
        )

    if payload.activities:
        acts = payload.activities
        activities_list = None
    else:
        activities_list = []
        d = start
        while d <= end:
            activities_list.append({
                "date": d,
                "territory_id": str(payload.territory_id),
                "activity_type": "Field Work",
                "planned_villages": [],
                "planned_dealers": [],
                "description": summary,
            })
            d += timedelta(days=1)
        acts = []
    activities_list = activities_list if activities_list is not None else [
        {
            "date": act.date,
            "territory_id": str(act.territory_id),
            "activity_type": act.activity_type,
            "planned_villages": act.planned_villages,
            "planned_dealers": act.planned_dealers,
            "description": act.description,
        }
        for act in acts
    ]
    result = await use_case.submit_plan(
        user_id=current_user.user_id,
        week_start_date=start,
        activities=activities_list,
        end_date=end,
        summary=summary,
    )

    # Tell managers/admins there is a plan to review.
    admins = await session.execute(text("SELECT id FROM users WHERE role IN ('admin', 'manager') AND is_active = true AND is_deleted = false"))
    repo = get_notification_repository(session)
    for (aid,) in admins.all():
        await repo.add(Notification(
            user_id=aid,
            title="Weekly Plan Submitted",
            message=f"{current_user.full_name} submitted a plan for {start} to {end}.",
            type="plan_submitted",
        ))
    return _to_response(result)


@router.get("", response_model=list[WeeklyPlanResponse])
async def list_weekly_plans(
    current_user: CurrentUser,
    use_case: Annotated[PlanningUseCase, Depends(get_planning_use_case)],
    status_filter: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[WeeklyPlanResponse]:
    # Enforce role-based scoping: non-admins can only see their own plans
    user_id_filter = None if current_user.role == "admin" else current_user.user_id
    result = await use_case.list_plans(
        user_id=user_id_filter,
        status=status_filter,
        limit=limit,
        offset=offset
    )
    return [_to_response(r) for r in result]


@router.patch("/{plan_id}/approve", response_model=WeeklyPlanResponse)
async def approve_weekly_plan(
    plan_id: uuid.UUID,
    payload: PlanApproveRequest,
    current_user: CurrentUser,
    use_case: Annotated[PlanningUseCase, Depends(get_planning_use_case)],
    notification_repo: Annotated[NotificationRepository, Depends(get_notification_repository)],
) -> WeeklyPlanResponse:
    if current_user.role != "admin" and current_user.role != "manager":
        raise HTTPException(status_code=403, detail="Only managers or admins can approve weekly plans.")

    if not payload.approve and not payload.comment:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Disapproval requires alternate plan or revision notes."
        )

    result = await use_case.approve_plan(
        plan_id=plan_id,
        manager_id=current_user.user_id,
        approve=payload.approve,
        comment=payload.comment,
    )

    # Fire notification to submitting officer
    status_text = "Approved" if payload.approve else "Disapproved"
    title_text = f"Weekly Plan {status_text}"
    msg_text = payload.comment if payload.comment else f"Your weekly plan has been {status_text.lower()}."

    notif = Notification(
        user_id=result.user_id,
        title=title_text,
        message=msg_text,
        type="approval_update"
    )
    await notification_repo.add(notif)

    return _to_response(result)


@router.post("/{plan_id}/deviate", response_model=WeeklyPlanResponse)
async def deviate_weekly_plan(
    plan_id: uuid.UUID,
    payload: PlanDeviationRequest,
    current_user: CurrentUser,
    use_case: Annotated[PlanningUseCase, Depends(get_planning_use_case)],
) -> WeeklyPlanResponse:
    plan = await use_case.get_plan(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Weekly plan not found.")
    if current_user.role not in ("admin", "manager") and plan.user_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="You can only record deviations on your own plan.")

    result = await use_case.record_deviation(
        plan_id=plan_id,
        date_val=payload.date,
        reason=payload.reason,
        details=payload.details,
    )
    return _to_response(result)


@router.get("/{plan_id}", response_model=Optional[WeeklyPlanResponse])
async def get_weekly_plan(
    plan_id: uuid.UUID,
    current_user: CurrentUser,
    use_case: Annotated[PlanningUseCase, Depends(get_planning_use_case)],
) -> Optional[WeeklyPlanResponse]:
    result = await use_case.get_plan(plan_id)
    if not result:
        return None
    if current_user.role not in ("admin", "manager") and result.user_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="You can only view your own plan.")
    return _to_response(result)


@router.get("/user/week", response_model=Optional[WeeklyPlanResponse])
async def get_user_plan_for_week(
    user_id: uuid.UUID,
    week_start: date,
    current_user: CurrentUser,
    use_case: Annotated[PlanningUseCase, Depends(get_planning_use_case)],
) -> Optional[WeeklyPlanResponse]:
    if current_user.role not in ("admin", "manager") and user_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="You can only view your own plan.")
    result = await use_case.get_user_plan_for_week(user_id, week_start)
    return _to_response(result) if result else None


def _to_response(plan) -> WeeklyPlanResponse:
    activities = [
        {
            "id": act.id,
            "date": act.date,
            "territory_id": act.territory_id,
            "activity_type": act.activity_type,
            "planned_villages": act.planned_villages,
            "planned_dealers": act.planned_dealers,
            "description": act.description,
        }
        for act in plan.activities
    ]
    deviations = [
        {
            "id": dev.id,
            "date": dev.date,
            "reason": dev.reason,
            "details": dev.details,
            "recorded_at": dev.recorded_at,
        }
        for dev in plan.deviations
    ]
    return WeeklyPlanResponse(
        id=plan.id,
        user_id=plan.user_id,
        week_start_date=plan.week_start_date,
        end_date=plan.end_date,
        summary=plan.summary,
        status=plan.status,
        approved_by=plan.approved_by,
        approved_at=plan.approved_at,
        manager_comment=plan.manager_comment,
        activities=activities,
        deviations=deviations,
        created_at=plan.created_at,
        updated_at=plan.updated_at,
    )
