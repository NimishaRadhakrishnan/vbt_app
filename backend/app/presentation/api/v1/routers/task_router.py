"""
Task assignment router.

Lets an admin/manager assign a concrete job to a specific officer with a
due date, and lets the officer move it through assigned -> in_progress ->
done. This is deliberately separate from Weekly Plans: plans are the
officer's own proposed week; tasks are company-directed work items handed
down to them — the "track and assign jobs" half of the app's stated goal.

`is_overdue` is computed at read time from due_date rather than stored,
so it's always correct without a background job flipping statuses.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.momentum.detection import check_momentum_milestones
from app.domain.repositories.notification_repository import NotificationRepository
from app.domain.entities.notification import Notification
from app.core.container import get_notification_repository
from app.domain.value_objects.role import Role
from app.infrastructure.database.session import get_db_session
from app.presentation.api.v1.dependencies import CurrentUser, require_role
from app.presentation.schemas.task_schemas import (
    TaskCreateRequest,
    TaskResponse,
    TaskReviewRequest,
    TaskStatusUpdateRequest,
    TaskUpdateRequest,
)

router = APIRouter(prefix="/tasks", tags=["tasks"])

_ALLOWED_STATUSES = {"assigned", "in_progress", "pending_review", "done", "cancelled"}
# Officers can move a task through these via PATCH /tasks/{id}/status.
# "done" is deliberately excluded - it's only ever reachable via
# PATCH /tasks/{id}/review (admin/manager approval), so there's exactly
# one code path that sets status='done', not two with different rules.
_OFFICER_SETTABLE_STATUSES = {"assigned", "in_progress", "pending_review", "cancelled"}
# related_type values that require photo proof before a task can move to
# pending_review - a farmer/dealer visit needs evidence; a general task
# doesn't have anywhere to point a camera.
_PROOF_REQUIRED_RELATED_TYPES = {"farmer", "dealer"}

_SELECT_TASK_SQL = """
    SELECT
        t.id, t.title, t.description, t.assigned_to,
        assignee.full_name AS assigned_to_name,
        t.assigned_by,
        assigner.full_name AS assigned_by_name,
        t.due_date, t.status, t.related_type, t.related_id,
        t.proof_photo_url, t.proof_gps_lat, t.proof_gps_lng,
        t.reviewed_by,
        reviewer.full_name AS reviewed_by_name,
        t.reviewed_at, t.rejection_reason,
        t.completed_at, t.created_at, t.updated_at
    FROM tasks t
    JOIN users assignee ON assignee.id = t.assigned_to
    LEFT JOIN users assigner ON assigner.id = t.assigned_by
    LEFT JOIN users reviewer ON reviewer.id = t.reviewed_by
"""


def _row_to_response(row) -> TaskResponse:
    # pending_review is deliberately excluded alongside done/cancelled -
    # the task is out of the officer's hands once submitted, so it
    # shouldn't be flagged overdue even if due_date has passed while it
    # sits waiting for a manager to review it.
    is_overdue = row.status not in ("done", "cancelled", "pending_review") and row.due_date < date.today()
    return TaskResponse(
        id=row.id,
        title=row.title,
        description=row.description,
        assigned_to=row.assigned_to,
        assigned_to_name=row.assigned_to_name,
        assigned_by=row.assigned_by,
        assigned_by_name=row.assigned_by_name,
        due_date=row.due_date,
        status=row.status,
        is_overdue=is_overdue,
        related_type=row.related_type,
        related_id=row.related_id,
        proof_photo_url=row.proof_photo_url,
        proof_gps_lat=row.proof_gps_lat,
        proof_gps_lng=row.proof_gps_lng,
        reviewed_by=row.reviewed_by,
        reviewed_by_name=row.reviewed_by_name,
        reviewed_at=row.reviewed_at,
        rejection_reason=row.rejection_reason,
        completed_at=row.completed_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(
    payload: TaskCreateRequest,
    current_user: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    notification_repo: Annotated[NotificationRepository, Depends(get_notification_repository)],
) -> TaskResponse:
    assignee_check = await session.execute(
        text("SELECT id, full_name FROM users WHERE id = :id").bindparams(id=payload.assigned_to)
    )
    assignee_row = assignee_check.first()
    if not assignee_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assigned officer not found.")

    task_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    await session.execute(
        text("""
            INSERT INTO tasks (id, title, description, assigned_to, assigned_by, due_date, status, related_type, related_id, created_at, updated_at)
            VALUES (:id, :title, :description, :assigned_to, :assigned_by, :due_date, 'assigned', :related_type, :related_id, :now, :now)
        """).bindparams(
            id=task_id,
            title=payload.title,
            description=payload.description,
            assigned_to=payload.assigned_to,
            assigned_by=current_user.user_id,
            due_date=payload.due_date,
            related_type=payload.related_type,
            related_id=payload.related_id,
            now=now,
        )
    )
    await session.commit()

    await notification_repo.add(
        Notification(
            user_id=payload.assigned_to,
            title="New task assigned",
            message=f'You have a new task: "{payload.title}" — due {payload.due_date.isoformat()}.',
            type="task_assigned",
        )
    )

    result = await session.execute(text(_SELECT_TASK_SQL + " WHERE t.id = :id").bindparams(id=task_id))
    return _row_to_response(result.first())


@router.get("", response_model=list[TaskResponse])
async def list_tasks(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    assigned_to: Optional[uuid.UUID] = None,
    status_filter: Optional[str] = None,
) -> list[TaskResponse]:
    # RBAC: non-admins/managers can only ever see their own tasks, enforced
    # server-side — the query parameter can't be used to look at someone
    # else's tasks regardless of what the frontend sends.
    is_privileged = current_user.role in (Role.ADMIN.value, Role.MANAGER.value)
    effective_assigned_to = assigned_to if is_privileged else current_user.user_id

    query = _SELECT_TASK_SQL + " WHERE t.is_deleted = false"
    params: dict = {}
    if effective_assigned_to is not None:
        query += " AND t.assigned_to = :assigned_to"
        params["assigned_to"] = effective_assigned_to
    if status_filter is not None:
        if status_filter not in _ALLOWED_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status filter. Must be one of {_ALLOWED_STATUSES}.")
        query += " AND t.status = :status_filter"
        params["status_filter"] = status_filter
    query += " ORDER BY t.due_date ASC, t.created_at DESC"

    result = await session.execute(text(query).bindparams(**params))
    return [_row_to_response(row) for row in result.all()]


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: uuid.UUID,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> TaskResponse:
    result = await session.execute(text(_SELECT_TASK_SQL + " WHERE t.id = :id").bindparams(id=task_id))
    row = result.first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")

    is_privileged = current_user.role in (Role.ADMIN.value, Role.MANAGER.value)
    if not is_privileged and row.assigned_to != current_user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only view your own tasks.")

    return _row_to_response(row)


@router.patch("/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: uuid.UUID,
    payload: TaskUpdateRequest,
    _current_user: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    notification_repo: Annotated[NotificationRepository, Depends(get_notification_repository)],
) -> TaskResponse:
    existing = await session.execute(text(_SELECT_TASK_SQL + " WHERE t.id = :id").bindparams(id=task_id))
    existing_row = existing.first()
    if not existing_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")

    fields_to_update = payload.model_dump(exclude_unset=True)
    if not fields_to_update:
        return _row_to_response(existing_row)

    if "assigned_to" in fields_to_update:
        assignee_check = await session.execute(
            text("SELECT id FROM users WHERE id = :id").bindparams(id=fields_to_update["assigned_to"])
        )
        if not assignee_check.first():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assigned officer not found.")

    set_clauses = ", ".join(f"{field} = :{field}" for field in fields_to_update)
    fields_to_update["id"] = task_id
    fields_to_update["updated_at"] = datetime.now(timezone.utc)
    await session.execute(
        text(f"UPDATE tasks SET {set_clauses}, updated_at = :updated_at WHERE id = :id").bindparams(**fields_to_update)
    )
    await session.commit()

    if "assigned_to" in payload.model_dump(exclude_unset=True):
        await notification_repo.add(
            Notification(
                user_id=fields_to_update["assigned_to"],
                title="Task reassigned to you",
                message=f'A task, "{existing_row.title}", has been reassigned to you.',
                type="task_assigned",
            )
        )

    result = await session.execute(text(_SELECT_TASK_SQL + " WHERE t.id = :id").bindparams(id=task_id))
    return _row_to_response(result.first())


@router.patch("/{task_id}/status", response_model=TaskResponse)
async def update_task_status(
    task_id: uuid.UUID,
    payload: TaskStatusUpdateRequest,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    notification_repo: Annotated[NotificationRepository, Depends(get_notification_repository)],

) -> TaskResponse:
    if payload.status not in _ALLOWED_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of {_ALLOWED_STATUSES}.")

    # 'done' is only reachable via PATCH /tasks/{id}/review (admin/manager
    # approval) - a task doesn't count as done, and doesn't feed momentum,
    # until someone has reviewed the submitted proof. This keeps exactly
    # one code path responsible for setting status='done', rather than
    # this endpoint and /review both being able to, with different rules.
    if payload.status == "done":
        raise HTTPException(
            status_code=400,
            detail="Tasks can no longer be marked done directly. Submit for review "
                   "(status='pending_review'), then an admin/manager approves via "
                   "PATCH /tasks/{task_id}/review.",
        )

    existing = await session.execute(text(_SELECT_TASK_SQL + " WHERE t.id = :id").bindparams(id=task_id))
    existing_row = existing.first()
    if not existing_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")

    is_privileged = current_user.role in (Role.ADMIN.value, Role.MANAGER.value)
    if not is_privileged and existing_row.assigned_to != current_user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only update your own tasks.")

    # Photo proof required to submit a farmer/dealer task for review - a
    # general task has nothing to photograph, so it's not required there.
    # GPS proof stays optional either way (stored if sent, via the
    # existing COALESCE pattern below), matching the original request:
    # location corroborates the photo, it isn't required on its own.
    if payload.status == "pending_review" and existing_row.related_type in _PROOF_REQUIRED_RELATED_TYPES:
        if not payload.proof_photo_url:
            raise HTTPException(
                status_code=400,
                detail=f"A proof photo is required to submit a {existing_row.related_type} task for review.",
            )

    await session.execute(
        text("""
            UPDATE tasks
            SET status = :status, updated_at = :updated_at,
                proof_photo_url = COALESCE(:photo, proof_photo_url),
                proof_gps_lat = COALESCE(:lat, proof_gps_lat),
                proof_gps_lng = COALESCE(:lng, proof_gps_lng)
            WHERE id = :id
        """).bindparams(
            status=payload.status,
            updated_at=datetime.now(timezone.utc),
            photo=payload.proof_photo_url,
            lat=payload.proof_gps_lat,
            lng=payload.proof_gps_lng,
            id=task_id,
        )
    )
    await session.commit()

    if payload.status == "pending_review" and existing_row.assigned_by:
        await notification_repo.add(
            Notification(
                user_id=existing_row.assigned_by,
                title="Task submitted for review",
                message=f'{existing_row.assigned_to_name} submitted "{existing_row.title}" for your review.',
                type="task_submitted_for_review",
            )
        )

    result = await session.execute(text(_SELECT_TASK_SQL + " WHERE t.id = :id").bindparams(id=task_id))
    return _row_to_response(result.first())


@router.patch("/{task_id}/review", response_model=TaskResponse)
async def review_task(
    task_id: uuid.UUID,
    payload: TaskReviewRequest,
    current_user: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    notification_repo: Annotated[NotificationRepository, Depends(get_notification_repository)],
) -> TaskResponse:
    existing = await session.execute(text(_SELECT_TASK_SQL + " WHERE t.id = :id").bindparams(id=task_id))
    existing_row = existing.first()
    if not existing_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")

    if existing_row.status != "pending_review":
        raise HTTPException(
            status_code=400,
            detail=f"Task is not awaiting review (current status: '{existing_row.status}').",
        )

    now = datetime.now(timezone.utc)

    if payload.approve:
        await session.execute(
            text("""
                UPDATE tasks
                SET status = 'done', completed_at = :now,
                    reviewed_by = :reviewer, reviewed_at = :now,
                    rejection_reason = NULL, updated_at = :now
                WHERE id = :id
            """).bindparams(now=now, reviewer=current_user.user_id, id=task_id)
        )
        # Same call, same place in the transaction as the old
        # update_task_status path used to make it - just moved here,
        # since this is now the only path that can set status='done'.
        await check_momentum_milestones(session, existing_row.assigned_to, existing_row.related_type)
        await session.commit()

        await notification_repo.add(
            Notification(
                user_id=existing_row.assigned_to,
                title="Task approved",
                message=f'Your task "{existing_row.title}" was reviewed and marked done.',
                type="task_completed",
            )
        )
    else:
        await session.execute(
            text("""
                UPDATE tasks
                SET status = 'in_progress', completed_at = NULL,
                    reviewed_by = :reviewer, reviewed_at = :now,
                    rejection_reason = :reason, updated_at = :now
                WHERE id = :id
            """).bindparams(now=now, reviewer=current_user.user_id, reason=payload.rejection_reason, id=task_id)
        )
        await session.commit()

        await notification_repo.add(
            Notification(
                user_id=existing_row.assigned_to,
                title="Task sent back for rework",
                message=(
                    f'"{existing_row.title}" was not approved.'
                    + (f' Reason: {payload.rejection_reason}' if payload.rejection_reason else '')
                ),
                type="task_rejected",
            )
        )

    result = await session.execute(text(_SELECT_TASK_SQL + " WHERE t.id = :id").bindparams(id=task_id))
    return _row_to_response(result.first())
