"""
Visit domain entity.
"""

from __future__ import annotations
from typing import Optional

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime


@dataclass
class Visit:
    user_id: uuid.UUID
    visit_type: str  # farmer, dealer
    start_time: datetime
    location_start_lat: float
    location_start_lng: float
    farmer_id: Optional[uuid.UUID] = None
    dealer_id: Optional[uuid.UUID] = None
    end_time: Optional[datetime] = None
    duration_seconds: Optional[int] = None
    location_end_lat: Optional[float] = None
    location_end_lng: Optional[float] = None
    photo_url_farmer: Optional[str] = None
    photo_url_farm: Optional[str] = None
    crop: Optional[str] = None
    purpose: Optional[str] = None
    products_demonstrated: list[str] = field(default_factory=list)
    task_completed: bool = True
    next_visit_date: Optional[date] = None
    voice_notes_url: Optional[str] = None
    voice_notes_transcript_ta: Optional[str] = None
    voice_notes_transcript_en: Optional[str] = None
    is_trial: bool = False
    farmers_covered: int = 0
    demos_conducted: int = 0
    villages_covered: list[str] = field(default_factory=list)
    cents_covered: Optional[float] = None
    conversions: int = 0
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)

    def complete_visit(self, end_time: datetime, end_lat: float, end_lng: float, task_completed: bool = True) -> None:
        self.end_time = end_time
        self.location_end_lat = end_lat
        self.location_end_lng = end_lng
        self.task_completed = task_completed
        if self.start_time:
            self.duration_seconds = int((end_time - self.start_time).total_seconds())