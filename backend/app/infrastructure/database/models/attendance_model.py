"""
Attendance database model.
"""

from __future__ import annotations
from typing import Optional

import uuid
from datetime import date, datetime

from geoalchemy2 import Geography
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.database.models.base_model import TimestampedUUIDMixin
from app.infrastructure.database.session import Base


class AttendanceModel(TimestampedUUIDMixin, Base):
    __tablename__ = "attendance"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    check_in_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    check_out_time: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    check_in_location: Mapped[str] = mapped_column(Geography(geometry_type="POINT", srid=4326), nullable=False)
    check_out_location: Mapped[Optional[str]] = mapped_column(Geography(geometry_type="POINT", srid=4326), nullable=True)
    check_in_device_id: Mapped[str] = mapped_column(String(100), nullable=False)
    check_in_phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    is_fake_gps: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_gps_disabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)