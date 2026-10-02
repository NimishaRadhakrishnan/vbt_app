"""
GPSTrack database model.
"""

from __future__ import annotations
from typing import Optional

import uuid
from datetime import datetime

from geoalchemy2 import Geography
from sqlalchemy import Boolean, DateTime, Double, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.database.models.base_model import TimestampedUUIDMixin
from app.infrastructure.database.session import Base


class GPSTrackModel(TimestampedUUIDMixin, Base):
    __tablename__ = "gps_tracks"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    location: Mapped[str] = mapped_column(Geography(geometry_type="POINT", srid=4326), nullable=False)
    accuracy: Mapped[float] = mapped_column(Double, nullable=False)
    speed: Mapped[float] = mapped_column(Double, default=0.0, nullable=False)
    is_idle: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    distance_from_prev: Mapped[float] = mapped_column(Double, default=0.0, nullable=False)
    territory_violation: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    battery_level: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)