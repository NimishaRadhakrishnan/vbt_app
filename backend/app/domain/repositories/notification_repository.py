"""
NotificationRepository interface.
"""

from __future__ import annotations
from typing import Optional

import uuid
from abc import ABC, abstractmethod

from app.domain.entities.notification import Notification


class NotificationRepository(ABC):
    @abstractmethod
    async def get_by_id(self, notification_id: uuid.UUID) -> Optional[Notification]: ...

    @abstractmethod
    async def add(self, notification: Notification) -> Notification: ...

    @abstractmethod
    async def update(self, notification: Notification) -> Notification: ...

    @abstractmethod
    async def list_by_user(self, user_id: uuid.UUID, *, is_read: Optional[bool] = None, limit: int = 50, offset: int = 0) -> list[Notification]: ...