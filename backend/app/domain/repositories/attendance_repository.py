"""
AttendanceRepository interface.
"""

from __future__ import annotations
from typing import Optional

import uuid
from abc import ABC, abstractmethod
from datetime import date

from app.domain.entities.attendance import Attendance


class AttendanceRepository(ABC):
    @abstractmethod
    async def get_by_id(self, attendance_id: uuid.UUID) -> Optional[Attendance]: ...

    @abstractmethod
    async def get_by_user_and_date(self, user_id: uuid.UUID, date_val: date) -> Optional[Attendance]: ...

    @abstractmethod
    async def add(self, attendance: Attendance) -> Attendance: ...

    @abstractmethod
    async def update(self, attendance: Attendance) -> Attendance: ...

    @abstractmethod
    async def list_by_user(self, user_id: uuid.UUID, *, limit: int = 50, offset: int = 0) -> list[Attendance]: ...

    @abstractmethod
    async def list_by_date(self, date_val: date, *, limit: int = 50, offset: int = 0) -> list[Attendance]: ...