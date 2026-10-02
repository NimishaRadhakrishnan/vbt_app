"""
Attendance domain entity.
"""

from __future__ import annotations
from typing import Optional

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime


@dataclass
class Attendance:
    user_id: uuid.UUID
    date: date
    check_in_time: datetime
    check_in_location_lat: float
    check_in_location_lng: float
    check_in_device_id: str
    check_out_time: Optional[datetime] = None
    check_out_location_lat: Optional[float] = None
    check_out_location_lng: Optional[float] = None
    check_in_phone: Optional[str] = None
    is_fake_gps: bool = False
    is_gps_disabled: bool = False
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)

    def check_out(self, check_out_time: datetime, lat: float, lng: float) -> None:
        self.check_out_time = check_out_time
        self.check_out_location_lat = lat
        self.check_out_location_lng = lng