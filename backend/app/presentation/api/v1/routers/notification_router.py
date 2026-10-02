"""
Notification Router endpoints.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.container import get_notification_repository
from app.domain.repositories.notification_repository import NotificationRepository
from app.presentation.api.v1.dependencies import CurrentUser
from app.presentation.schemas.notification_schemas import NotificationResponse

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationResponse])
async def list_notifications(
    current_user: CurrentUser,
    notification_repo: Annotated[NotificationRepository, Depends(get_notification_repository)],
    limit: int = 50,
    offset: int = 0,
) -> list[NotificationResponse]:
    result = await notification_repo.list_by_user(
        user_id=current_user.user_id,
        limit=limit,
        offset=offset
    )
    return [
        NotificationResponse(
            id=n.id,
            user_id=n.user_id,
            title=n.title,
            message=n.message,
            type=n.type,
            is_read=n.is_read,
            created_at=n.created_at,
        )
        for n in result
    ]


@router.post("/{notification_id}/read", response_model=NotificationResponse)
async def mark_as_read(
    notification_id: uuid.UUID,
    current_user: CurrentUser,
    notification_repo: Annotated[NotificationRepository, Depends(get_notification_repository)],
) -> NotificationResponse:
    notification = await notification_repo.get_by_id(notification_id)
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    if notification.user_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    notification.mark_as_read()
    updated = await notification_repo.update(notification)
    return NotificationResponse(
        id=updated.id,
        user_id=updated.user_id,
        title=updated.title,
        message=updated.message,
        type=updated.type,
        is_read=updated.is_read,
        created_at=updated.created_at,
    )


@router.post("/read-all")
async def mark_all_as_read(
    current_user: CurrentUser,
    notification_repo: Annotated[NotificationRepository, Depends(get_notification_repository)],
):
    unread = await notification_repo.list_by_user(
        user_id=current_user.user_id,
        is_read=False,
        limit=1000
    )
    for n in unread:
        n.mark_as_read()
        await notification_repo.update(n)
    return {"status": "success", "count": len(unread)}
