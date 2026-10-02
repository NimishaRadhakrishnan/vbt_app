"""
GPS Track domain entity.
"""

from __future__ import annotations
from typing import Optional

import uuid
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class GPSTrack:
    user_id: uuid.UUID
    recorded_at: datetime
    location_lat: float
    location_lng: float
    accuracy: float
    speed: float = 0.0
    is_idle: bool = False
    distance_from_prev: float = 0.0
    territory_violation: bool = False
    battery_level: Optional[int] = None
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)