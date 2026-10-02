from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid

class LocationPingRequest(BaseModel):
    officer_id: uuid.UUID
    lat: Optional[float] = None
    lng: Optional[float] = None
    accuracy: Optional[float] = None  # meters, from browser position.coords.accuracy
    speed_kmh: Optional[float] = None
    battery_pct: Optional[int] = None
    is_mocked: Optional[bool] = False
    status: str = "active"  # "active" or "location_unavailable"
    timestamp: datetime

class LocationActiveResponse(BaseModel):
    officer_id: uuid.UUID
    officer_name: str
    officer_role: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    accuracy: Optional[float] = None  # meters; None = never sent one
    speed: Optional[float] = None
    battery_level: Optional[int] = None
    status: str  # "active", "stale", "location_unavailable", "low_accuracy"
    updated_at: Optional[datetime] = None
    # Where/when the officer checked in today (from attendance), shown
    # alongside the live GPS ping — separate signal: "where they started
    # the day" vs "where they are right now".
    login_time: Optional[datetime] = None
    login_latitude: Optional[float] = None
    login_longitude: Optional[float] = None
