"""
SQLAlchemyFarmerRepository implementation.
"""

from __future__ import annotations
from typing import Optional
from datetime import date, datetime, time

import uuid

from geoalchemy2.shape import to_shape
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.entities.farmer import Farmer
from app.domain.repositories.farmer_repository import FarmerRepository
from app.infrastructure.database.models.farmer_model import FarmerModel


class SQLAlchemyFarmerRepository(FarmerRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    @staticmethod
    def _to_entity(model: FarmerModel) -> Farmer:
        lat, lng = None, None
        if model.location:
            pt = to_shape(model.location)
            lat, lng = pt.y, pt.x

        return Farmer(
            id=model.id,
            name=model.name,
            phone=model.phone,
            village=model.village,
            taluk=model.taluk,
            district=model.district,
            crop=model.crop,
            cents=model.cents,
            location_lat=lat,
            location_lng=lng,
            photo_url=model.photo_url,
            created_by=model.created_by,
            trial_conducted=model.trial_conducted,
            created_at=model.created_at,
            updated_at=model.updated_at,
        )

    async def get_by_id(self, farmer_id: uuid.UUID) -> Optional[Farmer]:
        model = await self._session.get(FarmerModel, farmer_id)
        return self._to_entity(model) if model else None

    async def get_by_phone(self, phone: str) -> Optional[Farmer]:
        result = await self._session.execute(
            select(FarmerModel).where(FarmerModel.phone == phone)
        )
        model = result.scalar_one_or_none()
        return self._to_entity(model) if model else None

    async def add(self, farmer: Farmer) -> Farmer:
        loc_wkt = None
        if farmer.location_lat is not None and farmer.location_lng is not None:
            loc_wkt = f"POINT({farmer.location_lng} {farmer.location_lat})"
        model = FarmerModel(
            id=farmer.id,
            name=farmer.name,
            phone=farmer.phone,
            village=farmer.village,
            taluk=farmer.taluk,
            district=farmer.district,
            crop=farmer.crop,
            cents=farmer.cents,
            location=loc_wkt,
            photo_url=farmer.photo_url,
            created_by=farmer.created_by,
            trial_conducted=farmer.trial_conducted,
        )
        self._session.add(model)
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_entity(model)

    async def update(self, farmer: Farmer) -> Farmer:
        model = await self._session.get(FarmerModel, farmer.id)
        if model is None:
            raise ValueError(f"Farmer not found: {farmer.id}")
        model.name = farmer.name
        model.phone = farmer.phone
        model.village = farmer.village
        model.taluk = farmer.taluk
        model.district = farmer.district
        model.crop = farmer.crop
        model.cents = farmer.cents
        if farmer.location_lat is not None and farmer.location_lng is not None:
            model.location = f"POINT({farmer.location_lng} {farmer.location_lat})"
        model.photo_url = farmer.photo_url
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_entity(model)

    async def search(
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
        query = select(FarmerModel).where(FarmerModel.is_deleted == False)  # noqa: E712
        if village:
            query = query.where(FarmerModel.village.ilike(f"%{village}%"))
        if taluk:
            query = query.where(FarmerModel.taluk.ilike(f"%{taluk}%"))
        if district:
            query = query.where(FarmerModel.district.ilike(f"%{district}%"))
        if crop:
            query = query.where(FarmerModel.crop.ilike(f"%{crop}%"))
        if date_from:
            query = query.where(FarmerModel.created_at >= datetime.combine(date_from, time.min))
        if date_to:
            query = query.where(FarmerModel.created_at <= datetime.combine(date_to, time.max))
        result = await self._session.execute(
            query.order_by(FarmerModel.created_at.desc()).limit(limit).offset(offset)
        )
        return [self._to_entity(m) for m in result.scalars().all()]

    async def count_all(self) -> int:
        result = await self._session.execute(select(func.count(FarmerModel.id)))
        return result.scalar() or 0