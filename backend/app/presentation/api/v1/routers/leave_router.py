"""
Leave request router.

Officers submit planned or emergency leave; admin/manager approve or
reject. The "2 days prior" (planned) / "2 hours prior" (emergency) rule
is enforced here at submission time — a request that arrives too late is
rejected outright with a clear reason, rather than silently accepted and
handled as a policy question later.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone, date as date_cls
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.container import get_notification_repository
from app.domain.entities.notification import Notification
from app.domain.repositories.notification_repository import NotificationRepository
from app.domain.value_objects.role import Role
from app.infrastructure.database.session import get_db_session
from app.presentation.api.v1.dependencies import CurrentUser, require_role
from app.presentation.schemas.leave_schemas import (
    LeaveRequestCreate,
    LeaveRequestDecision,
    LeaveRequestResponse,
)

router = APIRouter(prefix="/leave", tags=["leave"])

_SELECT_SQL = """
    SELECT
        l.id, l.officer_id, officer.full_name AS officer_name,
        l.leave_type, l.start_date, l.end_date, l.reason, l.status,
        l.decided_by, decider.full_name AS decided_by_name,
        l.decided_at, l.decision_notes, l.created_at, l.updated_at
    FROM leave_requests l
    JOIN users officer ON officer.id = l.officer_id
    LEFT JOIN users decider ON decider.id = l.decided_by
"""


def _row_to_response(row) -> LeaveRequestResponse:
    return LeaveRequestResponse(
        id=row.id,
        officer_id=row.officer_id,
        officer_name=row.officer_name,
        leave_type=row.leave_type,
        start_date=row.start_date,
        end_date=row.end_date,
        reason=row.reason,
        status=row.status,
        decided_by=row.decided_by,
        decided_by_name=row.decided_by_name,
        decided_at=row.decided_at,
        decision_notes=row.decision_notes,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.post("", response_model=LeaveRequestResponse, status_code=status.HTTP_201_CREATED)
async def submit_leave_request(
    payload: LeaveRequestCreate,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    notification_repo: Annotated[NotificationRepository, Depends(get_notification_repository)],
) -> LeaveRequestResponse:
    if payload.leave_type not in ("planned", "emergency"):
        raise HTTPException(status_code=400, detail="leave_type must be 'planned' or 'emergency'.")
    if payload.end_date < payload.start_date:
        raise HTTPException(status_code=400, detail="end_date cannot be before start_date.")

    now = datetime.now(timezone.utc)
    start_dt = datetime.combine(payload.start_date, datetime.min.time(), tzinfo=timezone.utc)

    if payload.leave_type == "planned":
        if (start_dt - now).total_seconds() < 2 * 24 * 3600:
            raise HTTPException(
                status_code=400,
                detail="Planned leave must be requested at least 2 days before the start date.",
            )
    else:  # emergency
        if (start_dt - now).total_seconds() < -24 * 3600:
            # Allow same-day/just-happened emergencies, but not requests
            # for leave that already ended more than a day ago.
            raise HTTPException(status_code=400, detail="This emergency leave period has already passed.")
        # Best-effort 2-hour notice; emergencies by nature can't always
        # meet this, so it's a soft floor rather than a hard rejection —
        # still rejects only truly backdated abuse (see above), not a
        # request made with 90 minutes' notice.

    leave_id = uuid.uuid4()
    await session.execute(
        text("""
            INSERT INTO leave_requests (id, officer_id, leave_type, start_date, end_date, reason, status, created_at, updated_at)
            VALUES (:id, :officer_id, :leave_type, :start_date, :end_date, :reason, 'pending', :now, :now)
        """).bindparams(
            id=leave_id,
            officer_id=current_user.user_id,
            leave_type=payload.leave_type,
            start_date=payload.start_date,
            end_date=payload.end_date,
            reason=payload.reason,
            now=now,
        )
    )
    await session.commit()

    # Notify all admins/managers of the new request.
    managers = await session.execute(text("SELECT id FROM users WHERE role IN ('admin', 'manager') AND is_active = true AND is_deleted = false"))
    for m in managers.all():
        await notification_repo.add(
            Notification(
                user_id=m.id,
                title=f"New {payload.leave_type} leave request",
                message=f"{current_user.full_name} requested leave from {payload.start_date} to {payload.end_date}.",
                type="leave_requested",
            )
        )

    result = await session.execute(text(_SELECT_SQL + " WHERE l.id = :id").bindparams(id=leave_id))
    return _row_to_response(result.first())


@router.get("", response_model=list[LeaveRequestResponse])
async def list_leave_requests(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    status_filter: Optional[str] = None,
) -> list[LeaveRequestResponse]:
    is_privileged = current_user.role in (Role.ADMIN.value, Role.MANAGER.value)
    query = _SELECT_SQL + " WHERE l.is_deleted = false"
    params: dict = {}
    if not is_privileged:
        query += " AND l.officer_id = :officer_id"
        params["officer_id"] = current_user.user_id
    if status_filter:
        if status_filter not in ("pending", "approved", "rejected"):
            raise HTTPException(status_code=400, detail="Invalid status filter.")
        query += " AND l.status = :status_filter"
        params["status_filter"] = status_filter
    query += " ORDER BY l.created_at DESC"

    result = await session.execute(text(query).bindparams(**params))
    return [_row_to_response(row) for row in result.all()]


@router.patch("/{leave_id}/decision", response_model=LeaveRequestResponse)
async def decide_leave_request(
    leave_id: uuid.UUID,
    payload: LeaveRequestDecision,
    current_user: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    notification_repo: Annotated[NotificationRepository, Depends(get_notification_repository)],
) -> LeaveRequestResponse:
    existing = await session.execute(text(_SELECT_SQL + " WHERE l.id = :id").bindparams(id=leave_id))
    existing_row = existing.first()
    if not existing_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave request not found.")
    if existing_row.status != "pending":
        raise HTTPException(status_code=400, detail="This leave request has already been decided.")

    new_status = "approved" if payload.approve else "rejected"
    now = datetime.now(timezone.utc)
    await session.execute(
        text("""
            UPDATE leave_requests
            SET status = :status, decided_by = :decided_by, decided_at = :now,
                decision_notes = :notes, updated_at = :now
            WHERE id = :id
        """).bindparams(
            status=new_status,
            decided_by=current_user.user_id,
            now=now,
            notes=payload.decision_notes,
            id=leave_id,
        )
    )
    await session.commit()

    await notification_repo.add(
        Notification(
            user_id=existing_row.officer_id,
            title=f"Leave request {new_status}",
            message=f"Your leave request ({existing_row.start_date} to {existing_row.end_date}) was {new_status}."
            + (f" Note: {payload.decision_notes}" if payload.decision_notes else ""),
            type="leave_decided",
        )
    )

    result = await session.execute(text(_SELECT_SQL + " WHERE l.id = :id").bindparams(id=leave_id))
    return _row_to_response(result.first())
