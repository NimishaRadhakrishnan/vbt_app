"""
SQLAlchemy implementation of the DailyWorkReportRepository.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.entities.daily_work_report import DailyWorkReport
from app.domain.repositories.daily_work_report_repository import DailyWorkReportRepository
from app.infrastructure.database.models.daily_work_report_model import DailyWorkReportModel
from app.infrastructure.database.models.user_model import UserModel


class SqlAlchemyDailyWorkReportRepository(DailyWorkReportRepository):
    def __init__(self, session: AsyncSession):
        self._session = session

    async def add(self, report: DailyWorkReport) -> DailyWorkReport:
        model = DailyWorkReportModel(
            id=report.id,
            user_id=report.user_id,
            report_date=report.report_date,
            summary=report.summary,
            attachment_url=report.attachment_url,
            created_at=report.created_at,
        )
        self._session.add(model)
        await self._session.flush()

        # Try to load officer_name for the returned entity if user exists in session
        await self._session.refresh(model, ["user"])
        if model.user:
            report.officer_name = model.user.full_name
            
        return report

    async def get_by_user_and_date(self, user_id: uuid.UUID, report_date: date) -> Optional[DailyWorkReport]:
        stmt = select(DailyWorkReportModel).where(
            DailyWorkReportModel.user_id == user_id,
            DailyWorkReportModel.report_date == report_date
        )
        result = await self._session.execute(stmt)
        model = result.scalars().first()
        if not model:
            return None
        return self._to_entity(model)

    async def list_reports(
        self,
        user_id: Optional[uuid.UUID] = None,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[DailyWorkReport]:
        stmt = select(DailyWorkReportModel).options(selectinload(DailyWorkReportModel.user))

        if user_id:
            stmt = stmt.where(DailyWorkReportModel.user_id == user_id)
        if from_date:
            stmt = stmt.where(DailyWorkReportModel.report_date >= from_date)
        if to_date:
            stmt = stmt.where(DailyWorkReportModel.report_date <= to_date)

        stmt = stmt.order_by(DailyWorkReportModel.created_at.desc()).limit(limit).offset(offset)
        result = await self._session.execute(stmt)
        
        entities = []
        for model in result.scalars().all():
            entity = self._to_entity(model)
            if model.user:
                entity.officer_name = model.user.full_name
            entities.append(entity)
            
        return entities

    def _to_entity(self, model: DailyWorkReportModel) -> DailyWorkReport:
        return DailyWorkReport(
            id=model.id,
            user_id=model.user_id,
            report_date=model.report_date,
            summary=model.summary,
            attachment_url=model.attachment_url,
            created_at=model.created_at,
        )
