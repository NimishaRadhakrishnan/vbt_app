"""
Holiday calendar router (section 7: "My Leave" calendar view).

Backs the officer-facing leave calendar's holiday markers. Reuses the
holiday_calendar table (date, description, is_national) that has existed
in the schema since 202607240002_create_vishakan_business_schema.py but
had no router at all before this - Sunday itself is computed client-side
(every Sunday, every year, needs no row here), this table only needs the
two moving holidays (Pongal, Diwali) plus anything else admin wants to add.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.value_objects.role import Role
from app.infrastructure.audit.audit_log import write_audit_log
from app.infrastructure.database.session import get_db_session
from app.presentation.api.v1.dependencies import CurrentUser, require_role

router = APIRouter(prefix="/holidays", tags=["holidays"])


class HolidayResponse(BaseModel):
    id: uuid.UUID
    date: date
    description: str
    is_national: bool


class HolidayCreateRequest(BaseModel):
    date: date
    description: str
    is_national: bool = True


@router.get("", response_model=list[HolidayResponse])
async def list_holidays(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    year: Optional[int] = None,
) -> list[HolidayResponse]:
    query = "SELECT id, date, description, is_national FROM holiday_calendar"
    params = {}
    if year:
        query += " WHERE EXTRACT(YEAR FROM date) = :year"
        params["year"] = year
    query += " ORDER BY date ASC"
    result = await session.execute(text(query).bindparams(**params))
    return [HolidayResponse(id=r.id, date=r.date, description=r.description, is_national=r.is_national) for r in result.all()]


@router.post("", response_model=HolidayResponse, status_code=status.HTTP_201_CREATED)
async def create_holiday(
    payload: HolidayCreateRequest,
    current_user: Annotated[object, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> HolidayResponse:
    existing = await session.execute(text("SELECT id FROM holiday_calendar WHERE date = :date").bindparams(date=payload.date))
    if existing.first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A holiday is already set for that date.")

    holiday_id = uuid.uuid4()
    await session.execute(
        text(
            """
            INSERT INTO holiday_calendar (id, date, description, is_national, created_at)
            VALUES (:id, :date, :description, :is_national, :now)
            """
        ).bindparams(id=holiday_id, date=payload.date, description=payload.description, is_national=payload.is_national, now=datetime.now(timezone.utc))
    )
    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_holiday_create",
        description=f"Admin added holiday '{payload.description}' on {payload.date.isoformat()}",
        context_data={"date": payload.date.isoformat(), "description": payload.description},
    )
    await session.commit()
    return HolidayResponse(id=holiday_id, date=payload.date, description=payload.description, is_national=payload.is_national)


@router.delete("/{holiday_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_holiday(
    holiday_id: uuid.UUID,
    current_user: Annotated[object, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    existing = await session.execute(text("SELECT id FROM holiday_calendar WHERE id = :id").bindparams(id=holiday_id))
    if not existing.first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Holiday not found.")

    await session.execute(text("DELETE FROM holiday_calendar WHERE id = :id").bindparams(id=holiday_id))
    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_holiday_delete",
        description=f"Admin removed holiday {holiday_id}",
        context_data={"holiday_id": str(holiday_id)},
    )
    await session.commit()
