"""
UserModel representing the 'users' table.
"""

from __future__ import annotations
from typing import Optional
from datetime import datetime

import uuid
from sqlalchemy import Boolean, String, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.database.models.base_model import TimestampedUUIDMixin
from app.infrastructure.database.session import Base


class UserModel(TimestampedUUIDMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="field_officer")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    employee_id: Mapped[Optional[str]] = mapped_column(String(50), unique=True, index=True, nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    device_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    biometric_token: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    manager_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    password_changed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    password_changed_by: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    failed_logins: Mapped[int] = mapped_column(nullable=False, default=0, server_default="0")
    last_failed_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")