"""
Weekly Plan database models.
"""

from __future__ import annotations
from typing import Optional

import uuid
from datetime import date, datetime

from sqlalchemy import ARRAY, Boolean, Date, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.infrastructure.database.models.base_model import TimestampedUUIDMixin
from app.infrastructure.database.session import Base


class WeeklyPlanModel(TimestampedUUIDMixin, Base):
    __tablename__ = "weekly_plans"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    week_start_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="draft", nullable=False)
    approved_by: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    manager_comment: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    activities: Mapped[list[WeeklyPlanActivityModel]] = relationship(
        "WeeklyPlanActivityModel", back_populates="weekly_plan", cascade="all, delete-orphan", lazy="selectin"
    )
    deviations: Mapped[list[WeeklyPlanDeviationModel]] = relationship(
        "WeeklyPlanDeviationModel", back_populates="weekly_plan", cascade="all, delete-orphan", lazy="selectin"
    )


class WeeklyPlanActivityModel(TimestampedUUIDMixin, Base):
    __tablename__ = "weekly_plan_activities"

    weekly_plan_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("weekly_plans.id", ondelete="CASCADE"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    territory_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("territories.id", ondelete="CASCADE"), nullable=False)
    activity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    planned_villages: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=True)
    planned_dealers: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    weekly_plan: Mapped[WeeklyPlanModel] = relationship("WeeklyPlanModel", back_populates="activities")


class WeeklyPlanDeviationModel(TimestampedUUIDMixin, Base):
    __tablename__ = "weekly_plan_deviations"

    weekly_plan_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("weekly_plans.id", ondelete="CASCADE"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Mapped[str] = mapped_column(String(50), nullable=False)
    details: Mapped[str] = mapped_column(String, nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    weekly_plan: Mapped[WeeklyPlanModel] = relationship("WeeklyPlanModel", back_populates="deviations")