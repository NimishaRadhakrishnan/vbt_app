"""
Visit database model.
"""

from __future__ import annotations
from typing import Optional

import uuid
from datetime import date, datetime

from geoalchemy2 import Geography
from sqlalchemy import ARRAY, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.database.models.base_model import TimestampedUUIDMixin
from app.infrastructure.database.session import Base


class VisitModel(TimestampedUUIDMixin, Base):
    __tablename__ = "visits"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    visit_type: Mapped[str] = mapped_column(String(20), nullable=False)
    farmer_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("farmers.id", ondelete="SET NULL"), nullable=True)
    dealer_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("dealers.id", ondelete="SET NULL"), nullable=True)
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    location_start: Mapped[str] = mapped_column(Geography(geometry_type="POINT", srid=4326), nullable=False)
    location_end: Mapped[Optional[str]] = mapped_column(Geography(geometry_type="POINT", srid=4326), nullable=True)
    photo_url_farmer: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    photo_url_farm: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    crop: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    purpose: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    products_demonstrated: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=True)
    task_completed: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    next_visit_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    voice_notes_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    voice_notes_transcript_ta: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    voice_notes_transcript_en: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # Trial field (section 4) - product-level detail (quantity given/left
    # over per product) lives in the separate visit_trial_products table,
    # not here; this is just the yes/no flag.
    is_trial: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    # Structured KPI rollup (section 5) - replaces the free-text
    # daily_work_reports.summary as the primary productivity record.
    farmers_covered: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")
    demos_conducted: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")
    villages_covered: Mapped[Optional[list[str]]] = mapped_column(ARRAY(String), nullable=True)
    cents_covered: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    conversions: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")