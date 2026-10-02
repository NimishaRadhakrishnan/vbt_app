"""
Attendance Pydantic schemas.
"""

from __future__ import annotations
from typing import Optional

import uuid
from datetime import date, datetime
from pydantic import BaseModel, Field


class CheckInRequest(BaseModel):
    device_id: str = Field(min_length=1, max_length=100)
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)
    phone: Optional[str] = Field(default=None, max_length=50)
    is_fake_gps: bool = Field(default=False)
    is_gps_disabled: bool = Field(default=False)


class CheckOutRequest(BaseModel):
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)


class AttendanceResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    date: date
    check_in_time: datetime
    check_in_location_lat: float
    check_in_location_lng: float
    check_in_device_id: str
    check_out_time: Optional[datetime] = None
    check_out_location_lat: Optional[float] = None
    check_out_location_lng: Optional[float] = None
    is_fake_gps: bool
    is_gps_disabled: bool
    user_name: Optional[str] = None
    user_role: Optional[str] = None
    employee_id: Optional[str] = None