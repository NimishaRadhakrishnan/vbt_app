"""
SQLAlchemyAttendanceRepository implementation.
"""

from __future__ import annotations
from typing import Optional

import uuid
from datetime import date

from geoalchemy2.shape import to_shape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.entities.attendance import Attendance
from app.domain.repositories.attendance_repository import AttendanceRepository
from app.infrastructure.database.models.attendance_model import AttendanceModel


class SQLAlchemyAttendanceRepository(AttendanceRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    @staticmethod
    def _to_entity(model: AttendanceModel) -> Attendance:
        in_point = to_shape(model.check_in_location)
        out_lat, out_lng = None, None
        if model.check_out_location:
            out_point = to_shape(model.check_out_location)
            out_lat, out_lng = out_point.y, out_point.x

        return Attendance(
            id=model.id,
            user_id=model.user_id,
            date=model.date,
            check_in_time=model.check_in_time,
            check_in_location_lat=in_point.y,
            check_in_location_lng=in_point.x,
            check_in_device_id=model.check_in_device_id,
            check_out_time=model.check_out_time,
            check_out_location_lat=out_lat,
            check_out_location_lng=out_lng,
            check_in_phone=model.check_in_phone,
            is_fake_gps=model.is_fake_gps,
            is_gps_disabled=model.is_gps_disabled,
            created_at=model.created_at,
        )

    async def get_by_id(self, attendance_id: uuid.UUID) -> Optional[Attendance]:
        model = await self._session.get(AttendanceModel, attendance_id)
        return self._to_entity(model) if model else None

    async def get_by_user_and_date(self, user_id: uuid.UUID, date_val: date) -> Optional[Attendance]:
        result = await self._session.execute(
            select(AttendanceModel).where(
                AttendanceModel.user_id == user_id,
                AttendanceModel.date == date_val
            )
        )
        model = result.scalar_one_or_none()
        return self._to_entity(model) if model else None

    async def add(self, attendance: Attendance) -> Attendance:
        model = AttendanceModel(
            id=attendance.id,
            user_id=attendance.user_id,
            date=attendance.date,
            check_in_time=attendance.check_in_time,
            check_in_location=f"POINT({attendance.check_in_location_lng} {attendance.check_in_location_lat})",
            check_in_device_id=attendance.check_in_device_id,
            check_in_phone=attendance.check_in_phone,
            is_fake_gps=attendance.is_fake_gps,
            is_gps_disabled=attendance.is_gps_disabled,
        )
        self._session.add(model)
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_entity(model)

    async def update(self, attendance: Attendance) -> Attendance:
        model = await self._session.get(AttendanceModel, attendance.id)
        if model is None:
            raise ValueError(f"Cannot update non-existent attendance {attendance.id}")
        model.check_out_time = attendance.check_out_time
        if attendance.check_out_location_lat is not None and attendance.check_out_location_lng is not None:
            model.check_out_location = f"POINT({attendance.check_out_location_lng} {attendance.check_out_location_lat})"
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_entity(model)

    async def list_by_user(self, user_id: uuid.UUID, *, limit: int = 50, offset: int = 0) -> list[Attendance]:
        result = await self._session.execute(
            select(AttendanceModel)
            .where(AttendanceModel.user_id == user_id)
            .order_by(AttendanceModel.date.desc())
            .limit(limit)
            .offset(offset)
        )
        return [self._to_entity(m) for m in result.scalars().all()]

    async def list_by_date(self, date_val: date, *, limit: int = 50, offset: int = 0) -> list[Attendance]:
        result = await self._session.execute(
            select(AttendanceModel)
            .where(AttendanceModel.date == date_val)
            .order_by(AttendanceModel.check_in_time.desc())
            .limit(limit)
            .offset(offset)
        )
        return [self._to_entity(m) for m in result.scalars().all()]