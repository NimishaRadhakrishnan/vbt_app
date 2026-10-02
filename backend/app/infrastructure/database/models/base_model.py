"""
Shared ORM mixin.

Every table in this platform (User now; MCPServer, RiskFinding, Alert,
AuditLog in later phases) gets a UUID primary key and created_at/updated_at
timestamps. Centralizing this avoids copy-pasted column definitions
drifting out of sync across ~10+ future tables.

`updated_by` (added in migration 202608260001) records who performed the
most recent write - set from the authenticated user in the use case/service
layer, never trusted from client input. It's nullable because the first
INSERT on a row created by a background/system process (or before this
column existed) has no attributable user; every use case that performs an
UPDATE going forward must set it explicitly.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column


class TimestampedUUIDMixin:
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    updated_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
