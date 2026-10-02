"""
WeeklyPlanRepository interface.
"""

from __future__ import annotations
from typing import Optional

import uuid
from abc import ABC, abstractmethod
from datetime import date

from app.domain.entities.weekly_plan import WeeklyPlan


class WeeklyPlanRepository(ABC):
    @abstractmethod
    async def get_by_id(self, plan_id: uuid.UUID) -> Optional[WeeklyPlan]: ...

    @abstractmethod
    async def get_by_user_and_week(self, user_id: uuid.UUID, week_start_date: date) -> Optional[WeeklyPlan]: ...

    @abstractmethod
    async def add(self, weekly_plan: WeeklyPlan) -> WeeklyPlan: ...

    @abstractmethod
    async def update(self, weekly_plan: WeeklyPlan) -> WeeklyPlan: ...

    @abstractmethod
    async def list_by_manager(self, manager_id: uuid.UUID, *, limit: int = 50, offset: int = 0) -> list[WeeklyPlan]: ...

    @abstractmethod
    async def list_pending(self, *, limit: int = 50, offset: int = 0) -> list[WeeklyPlan]: ...

    @abstractmethod
    async def list_plans(self, *, user_id: Optional[uuid.UUID] = None, status: Optional[str] = None, limit: int = 50, offset: int = 0) -> list[WeeklyPlan]: ...