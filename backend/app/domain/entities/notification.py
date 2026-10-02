"""
Notification domain entity.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class Notification:
    user_id: uuid.UUID
    title: str
    message: str
    type: str  # disease_uploaded, weekly_target_missed, outside_territory, low_dealer_stock, approval_update, broadcast
    is_read: bool = False
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)

    def mark_as_read(self) -> None:
        self.is_read = True
