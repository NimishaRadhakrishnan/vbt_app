"""
SQLAlchemyGPSTrackRepository implementation.
"""

from __future__ import annotations
from typing import Optional

import uuid
from datetime import datetime

from geoalchemy2.shape import to_shape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.entities.gps_track import GPSTrack
from app.domain.repositories.gps_track_repository import GPSTrackRepository
from app.infrastructure.database.models.gps_track_model import GPSTrackModel


class SQLAlchemyGPSTrackRepository(GPSTrackRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    @staticmethod
    def _to_entity(model: GPSTrackModel) -> GPSTrack:
        pt = to_shape(model.location)
        return GPSTrack(
            id=model.id,
            user_id=model.user_id,
            recorded_at=model.recorded_at,
            location_lat=pt.y,
            location_lng=pt.x,
            accuracy=model.accuracy,
            speed=model.speed,
            is_idle=model.is_idle,
            distance_from_prev=model.distance_from_prev,
            territory_violation=model.territory_violation,
            battery_level=model.battery_level,
            created_at=model.created_at,
        )

    async def add(self, gps_track: GPSTrack) -> GPSTrack:
        model = GPSTrackModel(
            id=gps_track.id,
            user_id=gps_track.user_id,
            recorded_at=gps_track.recorded_at,
            location=f"POINT({gps_track.location_lng} {gps_track.location_lat})",
            accuracy=gps_track.accuracy,
            speed=gps_track.speed,
            is_idle=gps_track.is_idle,
            distance_from_prev=gps_track.distance_from_prev,
            territory_violation=gps_track.territory_violation,
            battery_level=gps_track.battery_level,
        )
        self._session.add(model)
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_entity(model)

    async def get_history(self, user_id: uuid.UUID, start_time: datetime, end_time: datetime) -> list[GPSTrack]:
        result = await self._session.execute(
            select(GPSTrackModel)
            .where(
                GPSTrackModel.user_id == user_id,
                GPSTrackModel.recorded_at >= start_time,
                GPSTrackModel.recorded_at <= end_time
            )
            .order_by(GPSTrackModel.recorded_at.asc())
        )
        return [self._to_entity(m) for m in result.scalars().all()]

    async def get_latest(self, user_id: uuid.UUID) -> Optional[GPSTrack]:
        result = await self._session.execute(
            select(GPSTrackModel)
            .where(GPSTrackModel.user_id == user_id)
            .order_by(GPSTrackModel.recorded_at.desc())
            .limit(1)
        )
        model = result.scalar_one_or_none()
        return self._to_entity(model) if model else None