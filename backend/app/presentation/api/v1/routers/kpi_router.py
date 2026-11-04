"""
Targets, KPI & Incentive - read endpoints (phase 2).

Visibility is decided here from the logged-in user's token, never from an
officer_id the app sends: an officer reads only their own numbers, a
manager their direct reports, an admin everyone. Anyone else gets 403.
Screens read the saved snapshots; nothing is calculated in the request.
"""

from __future__ import annotations

import uuid

from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status

from app.application.use_cases import kpi_overview as ov
from app.application.use_cases.kpi_read import can_view, latest_snapshot
from app.infrastructure.database.session import AsyncSessionLocal
from app.presentation.api.v1.dependencies import CurrentUser

router = APIRouter(prefix="/kpi", tags=["Targets & Incentive"])


@router.get("/me")
async def my_goals(current_user: CurrentUser, period: str = Query("quarter", pattern="^(month|quarter)$")):
    """The logged-in officer's own numbers."""
    if current_user.role != "field_officer":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Goals are for field officers.")
    return await latest_snapshot(current_user.user_id, period, refresh=True)


def _officer_only(user):
    if user.role != "field_officer":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Goals are for field officers.")


@router.get("/me/overview")
async def my_overview(current_user: CurrentUser, period: str = Query("month", pattern="^(month|quarter)$")):
    """Everything the Dashboard card and My Goals screen need (token-derived: own numbers only)."""
    _officer_only(current_user)
    async with AsyncSessionLocal() as s:
        return await ov.overview(s, current_user.user_id, period)


@router.get("/me/series")
async def my_series(current_user: CurrentUser, item: str, period: str = Query("month", pattern="^(month|quarter)$")):
    _officer_only(current_user)
    async with AsyncSessionLocal() as s:
        try:
            return await ov.series(s, current_user.user_id, period, item)
        except ValueError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


@router.get("/me/calendar")
async def my_calendar(current_user: CurrentUser, month: Optional[date] = None):
    _officer_only(current_user)
    from app.infrastructure.config.company_time import company_today
    async with AsyncSessionLocal() as s:
        return await ov.calendar(s, current_user.user_id, month or company_today())


@router.get("/me/best")
async def my_best(current_user: CurrentUser):
    _officer_only(current_user)
    async with AsyncSessionLocal() as s:
        return {"items": await ov.best_months(s, current_user.user_id)}


@router.get("/me/past")
async def my_past(current_user: CurrentUser, period: str = Query("month", pattern="^(month|quarter)$")):
    _officer_only(current_user)
    async with AsyncSessionLocal() as s:
        return {"periods": await ov.past(s, current_user.user_id, period)}


@router.get("/me/entries")
async def my_entries(current_user: CurrentUser, item: str, period: str = Query("month", pattern="^(month|quarter)$")):
    """The list of entries behind a number (tap any number on the screen)."""
    _officer_only(current_user)
    async with AsyncSessionLocal() as s:
        try:
            return await ov.entries(s, current_user.user_id, period, item)
        except ValueError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


@router.get("/officers/{officer_id}")
async def officer_goals(officer_id: uuid.UUID, current_user: CurrentUser,
                        period: str = Query("quarter", pattern="^(month|quarter)$")):
    """Another officer's numbers: admin = anyone, manager = own team, others = 403."""
    async with AsyncSessionLocal() as s:
        if not await can_view(s, current_user, officer_id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only see your own numbers.")
    return await latest_snapshot(officer_id, period, refresh=True)
