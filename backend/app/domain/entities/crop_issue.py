"""
CropIssue domain entity.
"""

from __future__ import annotations
from typing import Optional

import uuid
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class CropIssue:
    user_id: uuid.UUID
    farmer_id: uuid.UUID
    crop: str
    district: str
    symptoms: str
    assigned_expert_whatsapp: str
    image_url: Optional[str] = None
    voice_notes_url: Optional[str] = None
    status: str = "pending"  # pending, resolved, closed
    expert_reply: Optional[str] = None
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)

    def resolve(self, reply: str) -> None:
        self.status = "resolved"
        self.expert_reply = reply
        self.updated_at = datetime.utcnow()

    def close(self) -> None:
        self.status = "closed"
        self.updated_at = datetime.utcnow()