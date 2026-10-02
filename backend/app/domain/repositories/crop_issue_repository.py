"""
CropIssueRepository interface.
"""

from __future__ import annotations
from typing import Optional

import uuid
from abc import ABC, abstractmethod

from app.domain.entities.crop_issue import CropIssue


class CropIssueRepository(ABC):
    @abstractmethod
    async def get_by_id(self, issue_id: uuid.UUID) -> Optional[CropIssue]: ...

    @abstractmethod
    async def add(self, crop_issue: CropIssue) -> CropIssue: ...

    @abstractmethod
    async def update(self, crop_issue: CropIssue) -> CropIssue: ...

    @abstractmethod
    async def list_issues(self, *, user_id: Optional[uuid.UUID] = None, district: Optional[str] = None, status: Optional[str] = None, limit: int = 50, offset: int = 0) -> list[CropIssue]: ...