"""
CropIssue database model.
"""

from __future__ import annotations
from typing import Optional

import uuid

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.database.models.base_model import TimestampedUUIDMixin
from app.infrastructure.database.session import Base


class CropIssueModel(TimestampedUUIDMixin, Base):
    __tablename__ = "crop_issues"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    farmer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("farmers.id", ondelete="CASCADE"), nullable=False)
    crop: Mapped[str] = mapped_column(String(100), nullable=False)
    district: Mapped[str] = mapped_column(String(100), nullable=False)
    symptoms: Mapped[str] = mapped_column(String, nullable=False)
    assigned_expert_whatsapp: Mapped[str] = mapped_column(String(50), nullable=False)
    image_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    voice_notes_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="pending", nullable=False)
    expert_reply: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")