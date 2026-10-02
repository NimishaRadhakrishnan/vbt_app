"""
VisitRepository interface.
"""

from __future__ import annotations
from typing import Optional

import uuid
from abc import ABC, abstractmethod
from datetime import datetime

from app.domain.entities.visit import Visit


class VisitRepository(ABC):
    @abstractmethod
    async def get_by_id(self, visit_id: uuid.UUID) -> Optional[Visit]: ...

    @abstractmethod
    async def add(self, visit: Visit) -> Visit: ...

    @abstractmethod
    async def update(self, visit: Visit) -> Visit: ...

    @abstractmethod
    async def list_by_user(self, user_id: uuid.UUID, start_time: Optional[datetime] = None, end_time: Optional[datetime] = None, *, limit: int = 50, offset: int = 0) -> list[Visit]: ...

    @abstractmethod
    async def get_active_visit(self, user_id: uuid.UUID) -> Optional[Visit]: ...

    @abstractmethod
    async def count_completed_and_missed(self, user_id: uuid.UUID, start_time: datetime, end_time: datetime) -> tuple[int, int]: ...