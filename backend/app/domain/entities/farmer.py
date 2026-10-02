"""
Farmer domain entity.
"""

from __future__ import annotations
from typing import Optional

import uuid
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class Farmer:
    name: str
    phone: str
    village: str
    taluk: str
    district: str
    crop: str
    cents: float
    location_lat: Optional[float] = None
    location_lng: Optional[float] = None
    photo_url: Optional[str] = None
    created_by: Optional[uuid.UUID] = None
    trial_conducted: bool = False
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)