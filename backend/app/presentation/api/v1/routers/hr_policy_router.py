"""
HR Policy router.

Every authenticated officer can read the policy sections (login timing,
leave rules, etc.). Only admins can edit them — content lives in the DB
so wording can be updated without a redeploy.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.value_objects.role import Role
from app.infrastructure.database.session import get_db_session
from app.presentation.api.v1.dependencies import CurrentUser, require_role
from app.presentation.schemas.hr_policy_schemas import HRPolicyResponse, HRPolicyUpdateRequest

router = APIRouter(prefix="/hr-policies", tags=["hr-policies"])


def _row_to_response(row) -> HRPolicyResponse:
    return HRPolicyResponse(
        id=row.id,
        section=row.section,
        title=row.title,
        content=row.content,
        display_order=row.display_order,
        updated_at=row.updated_at,
    )


@router.get("", response_model=list[HRPolicyResponse])
async def list_hr_policies(
    _current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[HRPolicyResponse]:
    result = await session.execute(
        text("SELECT id, section, title, content, display_order, updated_at FROM hr_policies WHERE is_deleted = false ORDER BY display_order ASC")
    )
    return [_row_to_response(row) for row in result.all()]


@router.patch("/{policy_id}", response_model=HRPolicyResponse)
async def update_hr_policy(
    policy_id: uuid.UUID,
    payload: HRPolicyUpdateRequest,
    current_user: Annotated[object, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> HRPolicyResponse:
    existing = await session.execute(
        text("SELECT id FROM hr_policies WHERE id = :id").bindparams(id=policy_id)
    )
    if not existing.first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Policy section not found.")

    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        result = await session.execute(
            text("SELECT id, section, title, content, display_order, updated_at FROM hr_policies WHERE id = :id").bindparams(id=policy_id)
        )
        return _row_to_response(result.first())

    fields["id"] = policy_id
    fields["updated_by"] = current_user.user_id
    fields["updated_at"] = datetime.now(timezone.utc)
    set_clauses = ", ".join(f"{k} = :{k}" for k in fields if k not in ("id",))
    await session.execute(text(f"UPDATE hr_policies SET {set_clauses} WHERE id = :id").bindparams(**fields))
    await session.commit()

    result = await session.execute(
        text("SELECT id, section, title, content, display_order, updated_at FROM hr_policies WHERE id = :id").bindparams(id=policy_id)
    )
    return _row_to_response(result.first())
