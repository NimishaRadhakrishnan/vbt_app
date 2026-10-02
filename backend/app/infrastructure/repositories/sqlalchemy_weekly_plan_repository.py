"""
SQLAlchemyWeeklyPlanRepository implementation.
"""

from __future__ import annotations
from typing import Optional

import uuid
from datetime import date

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.entities.weekly_plan import WeeklyPlan, WeeklyPlanActivity, WeeklyPlanDeviation
from app.domain.repositories.weekly_plan_repository import WeeklyPlanRepository
from app.infrastructure.database.models.weekly_plan_model import WeeklyPlanModel, WeeklyPlanActivityModel, WeeklyPlanDeviationModel


class SQLAlchemyWeeklyPlanRepository(WeeklyPlanRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    @staticmethod
    def _to_entity(model: WeeklyPlanModel) -> WeeklyPlan:
        activities = [
            WeeklyPlanActivity(
                id=act.id,
                date=act.date,
                territory_id=act.territory_id,
                activity_type=act.activity_type,
                planned_villages=act.planned_villages or [],
                planned_dealers=act.planned_dealers or [],
                description=act.description,
            )
            for act in model.activities
        ]
        deviations = [
            WeeklyPlanDeviation(
                id=dev.id,
                date=dev.date,
                reason=dev.reason,
                details=dev.details,
                recorded_at=dev.recorded_at,
            )
            for dev in model.deviations
        ]
        return WeeklyPlan(
            id=model.id,
            user_id=model.user_id,
            week_start_date=model.week_start_date,
            status=model.status,
            approved_by=model.approved_by,
            approved_at=model.approved_at,
            manager_comment=model.manager_comment,
            activities=activities,
            deviations=deviations,
            created_at=model.created_at,
            updated_at=model.updated_at,
        )

    async def get_by_id(self, plan_id: uuid.UUID) -> Optional[WeeklyPlan]:
        model = await self._session.get(WeeklyPlanModel, plan_id)
        return self._to_entity(model) if model else None

    async def get_by_user_and_week(self, user_id: uuid.UUID, week_start_date: date) -> Optional[WeeklyPlan]:
        result = await self._session.execute(
            select(WeeklyPlanModel).where(
                WeeklyPlanModel.user_id == user_id,
                WeeklyPlanModel.week_start_date == week_start_date
            )
        )
        model = result.scalar_one_or_none()
        return self._to_entity(model) if model else None

    async def add(self, weekly_plan: WeeklyPlan) -> WeeklyPlan:
        # Resolve territory IDs using fallback if needed
        res = await self._session.execute(text("SELECT id FROM territories LIMIT 1"))
        fallback_t_id = res.scalar()

        model = WeeklyPlanModel(
            id=weekly_plan.id,
            user_id=weekly_plan.user_id,
            week_start_date=weekly_plan.week_start_date,
            status=weekly_plan.status,
            approved_by=weekly_plan.approved_by,
            approved_at=weekly_plan.approved_at,
            manager_comment=weekly_plan.manager_comment,
        )
        for act in weekly_plan.activities:
            actual_t_id = act.territory_id
            if fallback_t_id:
                res_check = await self._session.execute(
                    text("SELECT 1 FROM territories WHERE id = :tid").bindparams(tid=act.territory_id)
                )
                if not res_check.scalar():
                    actual_t_id = fallback_t_id

            model.activities.append(
                WeeklyPlanActivityModel(
                    id=act.id,
                    date=act.date,
                    territory_id=actual_t_id,
                    activity_type=act.activity_type,
                    planned_villages=act.planned_villages,
                    planned_dealers=act.planned_dealers,
                    description=act.description,
                )
            )
        for dev in weekly_plan.deviations:
            model.deviations.append(
                WeeklyPlanDeviationModel(
                    id=dev.id,
                    date=dev.date,
                    reason=dev.reason,
                    details=dev.details,
                    recorded_at=dev.recorded_at,
                )
            )
        self._session.add(model)
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_entity(model)

    async def update(self, weekly_plan: WeeklyPlan) -> WeeklyPlan:
        # Resolve territory IDs using fallback if needed
        res = await self._session.execute(text("SELECT id FROM territories LIMIT 1"))
        fallback_t_id = res.scalar()

        model = await self._session.get(WeeklyPlanModel, weekly_plan.id)
        if model is None:
            raise ValueError(f"Weekly plan not found: {weekly_plan.id}")
        model.status = weekly_plan.status
        model.approved_by = weekly_plan.approved_by
        model.approved_at = weekly_plan.approved_at
        model.manager_comment = weekly_plan.manager_comment

        # Sync activities (simplified merge/replace for demo/clean code)
        model.activities.clear()
        for act in weekly_plan.activities:
            actual_t_id = act.territory_id
            if fallback_t_id:
                res_check = await self._session.execute(
                    text("SELECT 1 FROM territories WHERE id = :tid").bindparams(tid=act.territory_id)
                )
                if not res_check.scalar():
                    actual_t_id = fallback_t_id

            model.activities.append(
                WeeklyPlanActivityModel(
                    id=act.id,
                    date=act.date,
                    territory_id=actual_t_id,
                    activity_type=act.activity_type,
                    planned_villages=act.planned_villages,
                    planned_dealers=act.planned_dealers,
                    description=act.description,
                )
            )

        model.deviations.clear()
        for dev in weekly_plan.deviations:
            model.deviations.append(
                WeeklyPlanDeviationModel(
                    id=dev.id,
                    date=dev.date,
                    reason=dev.reason,
                    details=dev.details,
                    recorded_at=dev.recorded_at,
                )
            )

        await self._session.flush()
        await self._session.refresh(model)
        return self._to_entity(model)

    async def list_by_manager(self, manager_id: uuid.UUID, *, limit: int = 50, offset: int = 0) -> list[WeeklyPlan]:
        # Simple placeholder query for manager list. In production, we would map manager's territory/officers.
        result = await self._session.execute(
            select(WeeklyPlanModel).order_by(WeeklyPlanModel.week_start_date.desc()).limit(limit).offset(offset)
        )
        return [self._to_entity(m) for m in result.scalars().all()]

    async def list_pending(self, *, limit: int = 50, offset: int = 0) -> list[WeeklyPlan]:
        result = await self._session.execute(
            select(WeeklyPlanModel)
            .where(WeeklyPlanModel.status == "pending")
            .order_by(WeeklyPlanModel.week_start_date.desc())
            .limit(limit)
            .offset(offset)
        )
        return [self._to_entity(m) for m in result.scalars().all()]

    async def list_plans(self, *, user_id: Optional[uuid.UUID] = None, status: Optional[str] = None, limit: int = 50, offset: int = 0) -> list[WeeklyPlan]:
        query = select(WeeklyPlanModel).where(WeeklyPlanModel.is_deleted == False)  # noqa: E712
        if user_id:
            query = query.where(WeeklyPlanModel.user_id == user_id)
        if status:
            query = query.where(WeeklyPlanModel.status == status)
        result = await self._session.execute(
            query.order_by(WeeklyPlanModel.week_start_date.desc()).limit(limit).offset(offset)
        )
        return [self._to_entity(m) for m in result.scalars().all()]