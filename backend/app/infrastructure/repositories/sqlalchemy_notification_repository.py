"""
SQLAlchemyNotificationRepository implementation.
"""

from __future__ import annotations
from typing import Optional

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.entities.notification import Notification
from app.domain.repositories.notification_repository import NotificationRepository
from app.infrastructure.database.models.notification_model import NotificationModel


class SQLAlchemyNotificationRepository(NotificationRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    @staticmethod
    def _to_entity(model: NotificationModel) -> Notification:
        return Notification(
            id=model.id,
            user_id=model.user_id,
            title=model.title,
            message=model.message,
            type=model.type,
            is_read=model.is_read,
            created_at=model.created_at,
        )

    async def get_by_id(self, notification_id: uuid.UUID) -> Optional[Notification]:
        model = await self._session.get(NotificationModel, notification_id)
        return self._to_entity(model) if model else None

    async def add(self, notification: Notification) -> Notification:
        model = NotificationModel(
            id=notification.id,
            user_id=notification.user_id,
            title=notification.title,
            message=notification.message,
            type=notification.type,
            is_read=notification.is_read,
        )
        self._session.add(model)
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_entity(model)

    async def update(self, notification: Notification) -> Notification:
        model = await self._session.get(NotificationModel, notification.id)
        if model is None:
            raise ValueError(f"Notification not found: {notification.id}")
        model.is_read = notification.is_read
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_entity(model)

    async def list_by_user(self, user_id: uuid.UUID, *, is_read: Optional[bool] = None, limit: int = 50, offset: int = 0) -> list[Notification]:
        query = select(NotificationModel).where(NotificationModel.user_id == user_id)
        if is_read is not None:
            query = query.where(NotificationModel.is_read == is_read)
        result = await self._session.execute(
            query.order_by(NotificationModel.created_at.desc()).limit(limit).offset(offset)
        )
        return [self._to_entity(m) for m in result.scalars().all()]