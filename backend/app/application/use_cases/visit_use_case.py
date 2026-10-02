"""
Field Visit Use Case.
"""

from __future__ import annotations
from typing import Optional

import uuid
from datetime import date, datetime

from app.domain.entities.visit import Visit
from app.domain.repositories.visit_repository import VisitRepository
from app.domain.exceptions.domain_exceptions import (
    BusinessRuleViolationException,
    ConflictException,
)


class VisitUseCase:
    def __init__(self, visit_repository: VisitRepository) -> None:
        self._visit_repository = visit_repository

    async def start_visit(
        self,
        user_id: uuid.UUID,
        visit_type: str,
        lat: float,
        lng: float,
        farmer_id: Optional[uuid.UUID] = None,
        dealer_id: Optional[uuid.UUID] = None,
        photo_url_farmer: Optional[str] = None,
        photo_url_farm: Optional[str] = None,
        crop: Optional[str] = None,
        purpose: Optional[str] = None,
        products_demonstrated: Optional[list[str]] = None,
        is_trial: bool = False,
    ) -> Visit:
        # Check if user has an active visit running
        active = await self._visit_repository.get_active_visit(user_id)
        if active:
            raise ConflictException("You must complete your active visit session before starting a new one.")

        visit = Visit(
            user_id=user_id,
            visit_type=visit_type,
            start_time=datetime.utcnow(),
            location_start_lat=lat,
            location_start_lng=lng,
            farmer_id=farmer_id,
            dealer_id=dealer_id,
            photo_url_farmer=photo_url_farmer,
            photo_url_farm=photo_url_farm,
            crop=crop,
            purpose=purpose,
            products_demonstrated=products_demonstrated or [],
            is_trial=is_trial,
        )
        return await self._visit_repository.add(visit)

    async def end_visit(
        self,
        user_id: uuid.UUID,
        lat: float,
        lng: float,
        task_completed: bool = True,
        next_visit_date: Optional[date] = None,
        voice_notes_url: Optional[str] = None,
        voice_notes_transcript_ta: Optional[str] = None,
        voice_notes_transcript_en: Optional[str] = None,
        farmers_covered: Optional[int] = None,
        demos_conducted: Optional[int] = None,
        villages_covered: Optional[list[str]] = None,
        cents_covered: Optional[float] = None,
        conversions: Optional[int] = None,
    ) -> Visit:
        visit = await self._visit_repository.get_active_visit(user_id)
        if not visit:
            raise BusinessRuleViolationException("No active visit session found.")

        visit.complete_visit(datetime.utcnow(), lat, lng, task_completed)
        visit.next_visit_date = next_visit_date
        visit.voice_notes_url = voice_notes_url
        visit.voice_notes_transcript_ta = voice_notes_transcript_ta
        visit.voice_notes_transcript_en = voice_notes_transcript_en
        if farmers_covered is not None:
            visit.farmers_covered = farmers_covered
        if demos_conducted is not None:
            visit.demos_conducted = demos_conducted
        if villages_covered is not None:
            visit.villages_covered = villages_covered
        if cents_covered is not None:
            visit.cents_covered = cents_covered
        if conversions is not None:
            visit.conversions = conversions

        return await self._visit_repository.update(visit)

    async def get_active_visit(self, user_id: uuid.UUID) -> Optional[Visit]:
        return await self._visit_repository.get_active_visit(user_id)

    async def get_visit_history(self, user_id: uuid.UUID, limit: int = 50, offset: int = 0) -> list[Visit]:
        return await self._visit_repository.list_by_user(user_id, limit=limit, offset=offset)