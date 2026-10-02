"""
Farmer registry Use Cases.
"""

from __future__ import annotations
from typing import Optional
from datetime import date

import uuid

from app.domain.entities.farmer import Farmer
from app.domain.repositories.farmer_repository import FarmerRepository
from app.domain.exceptions.domain_exceptions import (
    BusinessRuleViolationException,
    ConflictException,
)


class FarmerUseCase:
    def __init__(self, farmer_repository: FarmerRepository) -> None:
        self._farmer_repository = farmer_repository

    async def register_farmer(
        self,
        name: str,
        phone: str,
        village: str,
        taluk: str,
        district: str,
        crop: str,
        cents: float,
        location_lat: Optional[float] = None,
        location_lng: Optional[float] = None,
        photo_url: Optional[str] = None,
        created_by: Optional[uuid.UUID] = None,
    ) -> Farmer:
        existing = await self._farmer_repository.get_by_phone(phone)
        if existing:
            raise ConflictException(f"A farmer with phone number {phone} is already registered.")

        farmer = Farmer(
            name=name,
            phone=phone,
            village=village,
            taluk=taluk,
            district=district,
            crop=crop,
            cents=cents,
            location_lat=location_lat,
            location_lng=location_lng,
            photo_url=photo_url,
            created_by=created_by,
        )
        return await self._farmer_repository.add(farmer)

    async def search_farmers(
        self,
        *,
        village: Optional[str] = None,
        taluk: Optional[str] = None,
        district: Optional[str] = None,
        crop: Optional[str] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Farmer]:
        return await self._farmer_repository.search(
            village=village, taluk=taluk, district=district, crop=crop,
            date_from=date_from, date_to=date_to, limit=limit, offset=offset
        )

    async def get_farmer_profile(self, farmer_id: uuid.UUID) -> Optional[Farmer]:
        return await self._farmer_repository.get_by_id(farmer_id)