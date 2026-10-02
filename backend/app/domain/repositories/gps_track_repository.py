"""
GPSTrackRepository interface.
"""

from __future__ import annotations
from typing import Optional

import uuid
from abc import ABC, abstractmethod
from datetime import datetime

from app.domain.entities.gps_track import GPSTrack


class GPSTrackRepository(ABC):
    @abstractmethod
    async def add(self, gps_track: GPSTrack) -> GPSTrack: ...

    @abstractmethod
    async def get_history(self, user_id: uuid.UUID, start_time: datetime, end_time: datetime) -> list[GPSTrack]: ...

    @abstractmethod
    async def get_latest(self, user_id: uuid.UUID) -> Optional[GPSTrack]: ...