"""
Weekly Planning Use Case.
"""

from __future__ import annotations
from typing import Optional

import uuid
from datetime import date, datetime

from app.domain.entities.weekly_plan import WeeklyPlan, WeeklyPlanActivity
from app.domain.repositories.weekly_plan_repository import WeeklyPlanRepository
from app.domain.exceptions.domain_exceptions import (
    BusinessRuleViolationException,
    ConflictException,
)


class PlanningUseCase:
    def __init__(self, weekly_plan_repository: WeeklyPlanRepository) -> None:
        self._weekly_plan_repository = weekly_plan_repository

    async def submit_plan(
        self,
        user_id: uuid.UUID,
        week_start_date: date,
        activities: list[dict],
    ) -> WeeklyPlan:
        # Check if plan already exists for this week
        existing = await self._weekly_plan_repository.get_by_user_and_week(user_id, week_start_date)
        if existing and existing.status in ("approved", "pending"):
            raise ConflictException(f"Weekly plan for {week_start_date} is already {existing.status} and cannot be modified.")

        plan_activities = [
            WeeklyPlanActivity(
                date=act["date"],
                territory_id=uuid.UUID(act["territory_id"]),
                activity_type=act["activity_type"],
                planned_villages=act.get("planned_villages", []),
                planned_dealers=act.get("planned_dealers", []),
                description=act.get("description"),
            )
            for act in activities
        ]

        if existing:
            existing.activities = plan_activities
            existing.status = "pending"
            existing.updated_at = datetime.utcnow()
            return await self._weekly_plan_repository.update(existing)
        else:
            plan = WeeklyPlan(
                user_id=user_id,
                week_start_date=week_start_date,
                status="pending",
                activities=plan_activities,
            )
            return await self._weekly_plan_repository.add(plan)

    async def approve_plan(self, plan_id: uuid.UUID, manager_id: uuid.UUID, approve: bool, comment: Optional[str] = None) -> WeeklyPlan:
        plan = await self._weekly_plan_repository.get_by_id(plan_id)
        if not plan:
            raise BusinessRuleViolationException("Weekly plan not found.")

        if approve:
            plan.approve(manager_id, comment)
        else:
            plan.reject(manager_id, comment)

        return await self._weekly_plan_repository.update(plan)

    async def record_deviation(self, plan_id: uuid.UUID, date_val: date, reason: str, details: str) -> WeeklyPlan:
        plan = await self._weekly_plan_repository.get_by_id(plan_id)
        if not plan:
            raise BusinessRuleViolationException("Weekly plan not found.")

        plan.add_deviation(date_val, reason, details)
        return await self._weekly_plan_repository.update(plan)

    async def get_plan(self, plan_id: uuid.UUID) -> Optional[WeeklyPlan]:
        return await self._weekly_plan_repository.get_by_id(plan_id)

    async def get_user_plan_for_week(self, user_id: uuid.UUID, week_start: date) -> Optional[WeeklyPlan]:
        return await self._weekly_plan_repository.get_by_user_and_week(user_id, week_start)

    async def list_plans(self, *, user_id: Optional[uuid.UUID] = None, status: Optional[str] = None, limit: int = 50, offset: int = 0) -> list[WeeklyPlan]:
        return await self._weekly_plan_repository.list_plans(
            user_id=user_id, status=status, limit=limit, offset=offset
        )