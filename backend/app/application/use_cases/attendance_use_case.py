"""
Attendance Use Case.
"""

from __future__ import annotations
from typing import Optional

import uuid
from datetime import date, datetime, timezone

from app.domain.entities.attendance import Attendance
from app.domain.repositories.attendance_repository import AttendanceRepository
from app.domain.repositories.user_repository import UserRepository
from app.domain.exceptions.domain_exceptions import (
    BusinessRuleViolationException,
    ConflictException,
)


class AttendanceUseCase:
    def __init__(self, attendance_repository: AttendanceRepository, user_repository: UserRepository) -> None:
        self._attendance_repository = attendance_repository
        self._user_repository = user_repository

    async def check_in(
        self,
        user_id: uuid.UUID,
        device_id: str,
        lat: float,
        lng: float,
        phone: Optional[str] = None,
        is_fake_gps: bool = False,
        is_gps_disabled: bool = False,
    ) -> Attendance:
        # Enforce single daily check-in
        today = date.today()
        existing = await self._attendance_repository.get_by_user_and_date(user_id, today)
        if existing:
            if existing.check_out_time is None:
                # Already on shift (e.g. signed out and back in, or a retry
                # after a dropped connection): hand back the open shift
                # instead of an error that strands the officer.
                return existing
            # Clocked out earlier today and starting again: reopen the same
            # day's record. One record per day is kept; the first check-in
            # time stays, the check-out is cleared.
            existing.check_out_time = None
            existing.check_out_location_lat = None
            existing.check_out_location_lng = None
            return await self._attendance_repository.update(existing)

        attendance = Attendance(
            user_id=user_id,
            date=today,
            check_in_time=datetime.now(timezone.utc),
            check_in_location_lat=lat,
            check_in_location_lng=lng,
            check_in_device_id=device_id,
            check_in_phone=phone,
            is_fake_gps=is_fake_gps,
            is_gps_disabled=is_gps_disabled,
        )
        return await self._attendance_repository.add(attendance)

    async def check_out(self, user_id: uuid.UUID, lat: float, lng: float) -> Attendance:
        today = date.today()
        attendance = await self._attendance_repository.get_by_user_and_date(user_id, today)
        if not attendance:
            raise BusinessRuleViolationException("No active check-in session found for today.")
        if attendance.check_out_time:
            raise ConflictException("You have already checked out for today.")

        attendance.check_out(datetime.now(timezone.utc), lat, lng)
        return await self._attendance_repository.update(attendance)

    async def get_today_status(self, user_id: uuid.UUID) -> Optional[Attendance]:
        return await self._attendance_repository.get_by_user_and_date(user_id, date.today())

    async def list_by_date(self, date_val: date, limit: int = 100, offset: int = 0) -> list[Attendance]:
        return await self._attendance_repository.list_by_date(date_val, limit=limit, offset=offset)

    async def list_by_user(self, user_id: uuid.UUID, limit: int = 60, offset: int = 0) -> list[Attendance]:
        return await self._attendance_repository.list_by_user(user_id, limit=limit, offset=offset)