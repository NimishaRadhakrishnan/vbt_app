"""
SQLAlchemyVisitRepository implementation.
"""

from __future__ import annotations
from typing import Optional

import uuid
from datetime import datetime

from geoalchemy2.shape import to_shape
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.entities.visit import Visit
from app.domain.repositories.visit_repository import VisitRepository
from app.infrastructure.database.models.visit_model import VisitModel


class SQLAlchemyVisitRepository(VisitRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    @staticmethod
    def _to_entity(model: VisitModel) -> Visit:
        pt_start = to_shape(model.location_start)
        end_lat, end_lng = None, None
        if model.location_end:
            pt_end = to_shape(model.location_end)
            end_lat, end_lng = pt_end.y, pt_end.x

        return Visit(
            id=model.id,
            user_id=model.user_id,
            visit_type=model.visit_type,
            start_time=model.start_time,
            location_start_lat=pt_start.y,
            location_start_lng=pt_start.x,
            farmer_id=model.farmer_id,
            dealer_id=model.dealer_id,
            end_time=model.end_time,
            duration_seconds=model.duration_seconds,
            location_end_lat=end_lat,
            location_end_lng=end_lng,
            photo_url_farmer=model.photo_url_farmer,
            photo_url_farm=model.photo_url_farm,
            crop=model.crop,
            purpose=model.purpose,
            products_demonstrated=model.products_demonstrated or [],
            task_completed=model.task_completed,
            next_visit_date=model.next_visit_date,
            voice_notes_url=model.voice_notes_url,
            voice_notes_transcript_ta=model.voice_notes_transcript_ta,
            voice_notes_transcript_en=model.voice_notes_transcript_en,
            created_at=model.created_at,
            is_trial=model.is_trial,
            farmers_covered=model.farmers_covered,
            demos_conducted=model.demos_conducted,
            villages_covered=model.villages_covered or [],
            cents_covered=float(model.cents_covered) if model.cents_covered is not None else None,
            conversions=model.conversions,
        )

    async def get_by_id(self, visit_id: uuid.UUID) -> Optional[Visit]:
        model = await self._session.get(VisitModel, visit_id)
        return self._to_entity(model) if model else None

    async def add(self, visit: Visit) -> Visit:
        model = VisitModel(
            id=visit.id,
            user_id=visit.user_id,
            visit_type=visit.visit_type,
            start_time=visit.start_time,
            location_start=f"POINT({visit.location_start_lng} {visit.location_start_lat})",
            farmer_id=visit.farmer_id,
            dealer_id=visit.dealer_id,
            photo_url_farmer=visit.photo_url_farmer,
            photo_url_farm=visit.photo_url_farm,
            crop=visit.crop,
            purpose=visit.purpose,
            products_demonstrated=visit.products_demonstrated,
            task_completed=visit.task_completed,
            next_visit_date=visit.next_visit_date,
            voice_notes_url=visit.voice_notes_url,
            voice_notes_transcript_ta=visit.voice_notes_transcript_ta,
            voice_notes_transcript_en=visit.voice_notes_transcript_en,
            is_trial=visit.is_trial,
        )
        self._session.add(model)
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_entity(model)

    async def update(self, visit: Visit) -> Visit:
        model = await self._session.get(VisitModel, visit.id)
        if model is None:
            raise ValueError(f"Visit not found: {visit.id}")
        model.end_time = visit.end_time
        model.duration_seconds = visit.duration_seconds
        if visit.location_end_lat is not None and visit.location_end_lng is not None:
            model.location_end = f"POINT({visit.location_end_lng} {visit.location_end_lat})"
        model.task_completed = visit.task_completed
        model.voice_notes_transcript_ta = visit.voice_notes_transcript_ta
        model.voice_notes_transcript_en = visit.voice_notes_transcript_en
        # Previously missing entirely - end_visit() sets these on the
        # entity but they were silently dropped since update() never
        # wrote them back to the model. Fixed alongside adding the new
        # KPI fields below, since KPI data has the exact same "set at
        # end-of-visit, must actually persist" requirement.
        model.next_visit_date = visit.next_visit_date
        model.voice_notes_url = visit.voice_notes_url
        model.is_trial = visit.is_trial
        model.farmers_covered = visit.farmers_covered
        model.demos_conducted = visit.demos_conducted
        model.villages_covered = visit.villages_covered or None
        model.cents_covered = visit.cents_covered
        model.conversions = visit.conversions
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_entity(model)

    async def list_by_user(self, user_id: uuid.UUID, start_time: Optional[datetime] = None, end_time: Optional[datetime] = None, *, limit: int = 50, offset: int = 0) -> list[Visit]:
        query = select(VisitModel).where(VisitModel.user_id == user_id)
        if start_time:
            query = query.where(VisitModel.start_time >= start_time)
        if end_time:
            query = query.where(VisitModel.start_time <= end_time)
        result = await self._session.execute(
            query.order_by(VisitModel.start_time.desc()).limit(limit).offset(offset)
        )
        return [self._to_entity(m) for m in result.scalars().all()]

    async def get_active_visit(self, user_id: uuid.UUID) -> Optional[Visit]:
        result = await self._session.execute(
            select(VisitModel)
            .where(VisitModel.user_id == user_id, VisitModel.end_time.is_(None))
            .limit(1)
        )
        model = result.scalar_one_or_none()
        return self._to_entity(model) if model else None

    async def count_completed_and_missed(self, user_id: uuid.UUID, start_time: datetime, end_time: datetime) -> tuple[int, int]:
        # Completed: end_time is not null. Missed: planned but not visited (simplified for demo).
        result_completed = await self._session.execute(
            select(func.count(VisitModel.id)).where(
                VisitModel.user_id == user_id,
                VisitModel.start_time >= start_time,
                VisitModel.start_time <= end_time,
                VisitModel.end_time.isnot(None)
            )
        )
        completed = result_completed.scalar() or 0
        return completed, 0