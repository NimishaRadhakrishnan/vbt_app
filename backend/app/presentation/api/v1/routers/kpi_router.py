"""
Targets, KPI & Incentive - read endpoints (phase 2).

Visibility is decided here from the logged-in user's token, never from an
officer_id the app sends: an officer reads only their own numbers, a
manager their direct reports, an admin everyone. Anyone else gets 403.
Screens read the saved snapshots; nothing is calculated in the request.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status

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


@router.get("/officers/{officer_id}")
async def officer_goals(officer_id: uuid.UUID, current_user: CurrentUser,
                        period: str = Query("quarter", pattern="^(month|quarter)$")):
    """Another officer's numbers: admin = anyone, manager = own team, others = 403."""
    async with AsyncSessionLocal() as s:
        if not await can_view(s, current_user, officer_id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only see your own numbers.")
    return await latest_snapshot(officer_id, period, refresh=True)
