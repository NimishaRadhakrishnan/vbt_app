"""
Territory database model.
"""

from __future__ import annotations
from typing import Optional

from geoalchemy2 import Geography
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.database.models.base_model import TimestampedUUIDMixin
from app.infrastructure.database.session import Base


class TerritoryModel(TimestampedUUIDMixin, Base):
    __tablename__ = "territories"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    district: Mapped[str] = mapped_column(String(100), nullable=False)
    taluk: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    village: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    boundary: Mapped[Optional[str]] = mapped_column(Geography(geometry_type="POLYGON", srid=4326), nullable=True)