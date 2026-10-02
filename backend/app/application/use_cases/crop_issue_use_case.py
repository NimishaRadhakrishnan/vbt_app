"""
CropIssue disease tickets Use Case.
"""

from __future__ import annotations
from typing import Optional

import uuid
from datetime import datetime

from app.domain.entities.crop_issue import CropIssue
from app.domain.repositories.crop_issue_repository import CropIssueRepository
from app.domain.exceptions.domain_exceptions import (
    BusinessRuleViolationException,
    ConflictException,
)


# Default district expert mapping
_EXPERT_DIRECTORY = {
    "Salem": "+919876543210",
    "Namakkal": "+919876543211",
    "Dharmapuri": "+919876543212",
    "Erode": "+919876543213",
    "Coimbatore": "+919876543214",
    "Trichy": "+919876543215",
}
_DEFAULT_EXPERT_HOTLINE = "+919876543219"


class CropIssueUseCase:
    def __init__(self, crop_issue_repository: CropIssueRepository) -> None:
        self._crop_issue_repository = crop_issue_repository

    async def report_issue(
        self,
        user_id: uuid.UUID,
        farmer_id: uuid.UUID,
        crop: str,
        district: str,
        symptoms: str,
        image_url: Optional[str] = None,
        voice_notes_url: Optional[str] = None,
    ) -> CropIssue:
        # Determine expert whatsapp contact based on district mapping
        assigned_expert = _EXPERT_DIRECTORY.get(district, _DEFAULT_EXPERT_HOTLINE)

        crop_issue = CropIssue(
            user_id=user_id,
            farmer_id=farmer_id,
            crop=crop,
            district=district,
            symptoms=symptoms,
            assigned_expert_whatsapp=assigned_expert,
            image_url=image_url,
            voice_notes_url=voice_notes_url,
            status="pending",
        )
        return await self._crop_issue_repository.add(crop_issue)

    async def update_issue_status(self, issue_id: uuid.UUID, status: str, expert_reply: Optional[str] = None) -> CropIssue:
        issue = await self._crop_issue_repository.get_by_id(issue_id)
        if not issue:
            raise BusinessRuleViolationException("Crop issue ticket not found.")

        issue.status = status
        if expert_reply:
            issue.expert_reply = expert_reply
        issue.updated_at = datetime.utcnow()

        return await self._crop_issue_repository.update(issue)

    async def get_by_id(self, issue_id: uuid.UUID) -> Optional[CropIssue]:
        return await self._crop_issue_repository.get_by_id(issue_id)

    async def list_issues(self, *, user_id: Optional[uuid.UUID] = None, district: Optional[str] = None, status: Optional[str] = None, limit: int = 50, offset: int = 0) -> list[CropIssue]:
        return await self._crop_issue_repository.list_issues(
            user_id=user_id, district=district, status=status, limit=limit, offset=offset
        )