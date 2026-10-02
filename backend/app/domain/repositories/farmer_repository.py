"""
FarmerRepository interface.
"""

from __future__ import annotations
from typing import Optional
from datetime import date

import uuid
from abc import ABC, abstractmethod

from app.domain.entities.farmer import Farmer


class FarmerRepository(ABC):
    @abstractmethod
    async def get_by_id(self, farmer_id: uuid.UUID) -> Optional[Farmer]: ...

    @abstractmethod
    async def get_by_phone(self, phone: str) -> Optional[Farmer]: ...

    @abstractmethod
    async def add(self, farmer: Farmer) -> Farmer: ...

    @abstractmethod
    async def update(self, farmer: Farmer) -> Farmer: ...

    @abstractmethod
    async def search(
        self,
        *,
        village: Optional[str] = None,
        taluk: Optional[str] = None,
        district: Optional[str] = None,
        crop: Optional[str] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Farmer]: ...

    @abstractmethod
    async def count_all(self) -> int: ...