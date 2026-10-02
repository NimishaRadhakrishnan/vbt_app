"""
SQLAlchemyCropIssueRepository implementation.
"""

from __future__ import annotations
from typing import Optional

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.entities.crop_issue import CropIssue
from app.domain.repositories.crop_issue_repository import CropIssueRepository
from app.infrastructure.database.models.crop_issue_model import CropIssueModel


class SQLAlchemyCropIssueRepository(CropIssueRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    @staticmethod
    def _to_entity(model: CropIssueModel) -> CropIssue:
        return CropIssue(
            id=model.id,
            user_id=model.user_id,
            farmer_id=model.farmer_id,
            crop=model.crop,
            district=model.district,
            symptoms=model.symptoms,
            assigned_expert_whatsapp=model.assigned_expert_whatsapp,
            image_url=model.image_url,
            voice_notes_url=model.voice_notes_url,
            status=model.status,
            expert_reply=model.expert_reply,
            created_at=model.created_at,
            updated_at=model.updated_at,
        )

    async def get_by_id(self, issue_id: uuid.UUID) -> Optional[CropIssue]:
        model = await self._session.get(CropIssueModel, issue_id)
        return self._to_entity(model) if model else None

    async def add(self, crop_issue: CropIssue) -> CropIssue:
        model = CropIssueModel(
            id=crop_issue.id,
            user_id=crop_issue.user_id,
            farmer_id=crop_issue.farmer_id,
            crop=crop_issue.crop,
            district=crop_issue.district,
            symptoms=crop_issue.symptoms,
            assigned_expert_whatsapp=crop_issue.assigned_expert_whatsapp,
            image_url=crop_issue.image_url,
            voice_notes_url=crop_issue.voice_notes_url,
            status=crop_issue.status,
            expert_reply=crop_issue.expert_reply,
        )
        self._session.add(model)
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_entity(model)

    async def update(self, crop_issue: CropIssue) -> CropIssue:
        model = await self._session.get(CropIssueModel, crop_issue.id)
        if model is None:
            raise ValueError(f"Crop issue not found: {crop_issue.id}")
        model.status = crop_issue.status
        model.expert_reply = crop_issue.expert_reply
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_entity(model)

    async def list_issues(self, *, user_id: Optional[uuid.UUID] = None, district: Optional[str] = None, status: Optional[str] = None, limit: int = 50, offset: int = 0) -> list[CropIssue]:
        query = select(CropIssueModel).where(CropIssueModel.is_deleted == False)  # noqa: E712
        if user_id:
            query = query.where(CropIssueModel.user_id == user_id)
        if district:
            query = query.where(CropIssueModel.district.ilike(f"%{district}%"))
        if status:
            query = query.where(CropIssueModel.status == status)
        result = await self._session.execute(
            query.order_by(CropIssueModel.created_at.desc()).limit(limit).offset(offset)
        )
        return [self._to_entity(m) for m in result.scalars().all()]