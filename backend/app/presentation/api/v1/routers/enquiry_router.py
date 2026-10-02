"""
Farmer Enquiry router.

For farmers who are hesitant to share their name/phone/address, an
officer can log just the issue description and an optional photo on
their behalf — no link to a farmer record. Any officer, manager, or
admin can pick it up and resolve it with a solution.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.session import get_db_session
from app.infrastructure.storage.local_file_storage import save_upload
from app.presentation.api.v1.dependencies import CurrentUser
from app.presentation.schemas.enquiry_schemas import (
    EnquiryCreateRequest,
    EnquiryResolveRequest,
    EnquiryResponse,
)

router = APIRouter(prefix="/enquiries", tags=["enquiries"])

_SELECT_SQL = """
    SELECT
        e.id, e.reported_by, reporter.full_name AS reported_by_name,
        e.district, e.description, e.image_url, e.status, e.solution,
        e.resolved_by, resolver.full_name AS resolved_by_name,
        e.resolved_at, e.created_at, e.updated_at
    FROM enquiries e
    JOIN users reporter ON reporter.id = e.reported_by
    LEFT JOIN users resolver ON resolver.id = e.resolved_by
"""


def _row_to_response(row) -> EnquiryResponse:
    return EnquiryResponse(
        id=row.id,
        reported_by=row.reported_by,
        reported_by_name=row.reported_by_name,
        district=row.district,
        description=row.description,
        image_url=row.image_url,
        status=row.status,
        solution=row.solution,
        resolved_by=row.resolved_by,
        resolved_by_name=row.resolved_by_name,
        resolved_at=row.resolved_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.post("/upload")
async def upload_enquiry_image(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    file: UploadFile = File(...),
) -> dict:
    url = await save_upload(file, current_user.user_id, session)
    return {"url": url}


@router.post("", response_model=EnquiryResponse, status_code=status.HTTP_201_CREATED)
async def create_enquiry(
    payload: EnquiryCreateRequest,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> EnquiryResponse:
    enquiry_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    await session.execute(
        text("""
            INSERT INTO enquiries (id, reported_by, district, description, image_url, status, created_at, updated_at)
            VALUES (:id, :reported_by, :district, :description, :image_url, 'open', :now, :now)
        """).bindparams(
            id=enquiry_id,
            reported_by=current_user.user_id,
            district=payload.district,
            description=payload.description,
            image_url=payload.image_url,
            now=now,
        )
    )
    await session.commit()

    result = await session.execute(text(_SELECT_SQL + " WHERE e.id = :id").bindparams(id=enquiry_id))
    return _row_to_response(result.first())


@router.get("", response_model=list[EnquiryResponse])
async def list_enquiries(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    status_filter: Optional[str] = None,
) -> list[EnquiryResponse]:
    is_privileged = current_user.role in ("admin", "manager")
    query = _SELECT_SQL + " WHERE e.is_deleted = false"
    params: dict = {}
    if not is_privileged:
        query += " AND e.reported_by = :reported_by"
        params["reported_by"] = current_user.user_id
    if status_filter:
        if status_filter not in ("open", "resolved"):
            raise HTTPException(status_code=400, detail="Invalid status filter.")
        query += " AND e.status = :status_filter"
        params["status_filter"] = status_filter
    query += " ORDER BY e.created_at DESC"

    result = await session.execute(text(query).bindparams(**params))
    return [_row_to_response(row) for row in result.all()]


@router.post("/{enquiry_id}/resolve", response_model=EnquiryResponse)
async def resolve_enquiry(
    enquiry_id: uuid.UUID,
    payload: EnquiryResolveRequest,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> EnquiryResponse:
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Only administrators or managers can resolve enquiries.")

    existing = await session.execute(text(_SELECT_SQL + " WHERE e.id = :id").bindparams(id=enquiry_id))
    existing_row = existing.first()
    if not existing_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Enquiry not found.")

    now = datetime.now(timezone.utc)
    await session.execute(
        text("""
            UPDATE enquiries
            SET status = 'resolved', solution = :solution, resolved_by = :resolved_by,
                resolved_at = :now, updated_at = :now
            WHERE id = :id
        """).bindparams(solution=payload.solution, resolved_by=current_user.user_id, now=now, id=enquiry_id)
    )
    await session.commit()

    result = await session.execute(text(_SELECT_SQL + " WHERE e.id = :id").bindparams(id=enquiry_id))
    return _row_to_response(result.first())
