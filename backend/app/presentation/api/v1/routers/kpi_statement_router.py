"""
Targets, KPI & Incentive - statements and team overview (phase 5).

Reading: admin = everyone, manager = own team (the use case decides from the
token). Writing (close, reopen, approve, paid): admin only.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.use_cases import kpi_statements as stm
from app.domain.value_objects.role import Role
from app.infrastructure.database.session import get_db_session
from app.presentation.api.v1.dependencies import CurrentUser, require_role

router = APIRouter(prefix="/kpi", tags=["Targets & Incentive (statements)"])
Session = Annotated[AsyncSession, Depends(get_db_session)]
Oversight = Depends(require_role(Role.ADMIN, Role.MANAGER))
AdminOnly = Depends(require_role(Role.ADMIN))
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


async def _guard(coro):
    try:
        return await coro
    except stm.StatementError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


class CloseBody(BaseModel):
    period_id: uuid.UUID
    allow_missing: bool = False


class ReopenBody(BaseModel):
    period_id: uuid.UUID
    reason: str


class PeriodBody(BaseModel):
    period_id: uuid.UUID


class PaidBody(BaseModel):
    paid_on: date


@router.get("/statements/periods", dependencies=[Oversight])
async def periods(s: Session):
    return {"periods": await stm.periods(s)}


@router.get("/statements", dependencies=[Oversight])
async def statements(s: Session, user: CurrentUser, period_id: uuid.UUID):
    return await _guard(stm.list_statements(s, user, period_id))


@router.get("/statements/export.xlsx", dependencies=[Oversight])
async def export_xlsx(s: Session, user: CurrentUser, period_id: uuid.UUID):
    data = await _guard(stm.export_xlsx(s, user, period_id))
    return Response(data, media_type=XLSX, headers={"Content-Disposition": 'attachment; filename="incentive-statements.xlsx"'})


@router.get("/statements/export.pdf", dependencies=[Oversight])
async def export_pdf(s: Session, user: CurrentUser, period_id: uuid.UUID):
    data = await _guard(stm.export_pdf(s, user, period_id))
    return Response(data, media_type="application/pdf", headers={"Content-Disposition": 'attachment; filename="incentive-statements.pdf"'})


@router.post("/statements/close", dependencies=[AdminOnly])
async def close(body: CloseBody, s: Session, user: CurrentUser):
    return await _guard(stm.close_period(s, user.user_id, body.period_id, body.allow_missing))


@router.post("/statements/reopen", dependencies=[AdminOnly])
async def reopen(body: ReopenBody, s: Session, user: CurrentUser):
    return await _guard(stm.reopen_period(s, user.user_id, body.period_id, body.reason))


@router.post("/statements/approve-all", dependencies=[AdminOnly])
async def approve_all(body: PeriodBody, s: Session, user: CurrentUser):
    return await _guard(stm.approve_all(s, user.user_id, body.period_id))


@router.post("/statements/{statement_id}/approve", dependencies=[AdminOnly])
async def approve_one(statement_id: uuid.UUID, s: Session, user: CurrentUser):
    return await _guard(stm.approve_one(s, user.user_id, statement_id))


@router.post("/statements/{statement_id}/paid", dependencies=[AdminOnly])
async def paid(statement_id: uuid.UUID, body: PaidBody, s: Session, user: CurrentUser):
    return await _guard(stm.mark_paid(s, user.user_id, statement_id, body.paid_on))


@router.get("/statements/officer/{officer_id}", dependencies=[Oversight])
async def officer_statement(officer_id: uuid.UUID, period_id: uuid.UUID, s: Session, user: CurrentUser):
    if officer_id not in await stm.team_ids(s, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only see your own team.")
    return await _guard(stm.detail(s, officer_id, period_id))


@router.get("/me/statement")
async def my_statement(period_id: uuid.UUID, s: Session, user: CurrentUser):
    """An officer's own statement, only after the office has closed the quarter."""
    if user.role != "field_officer":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Statements are for field officers.")
    return await _guard(stm.own_statement(s, user.user_id, period_id))


@router.get("/team-overview", dependencies=[Oversight])
async def team_overview(s: Session, user: CurrentUser, kind: str = Query("quarter", pattern="^(month|quarter)$"),
                        period_id: Optional[uuid.UUID] = None, region_id: Optional[uuid.UUID] = None,
                        mode: Optional[str] = Query(None, pattern="^(field|sales|both)$")):
    return await _guard(stm.team_overview(s, user, kind, period_id, region_id, mode))
