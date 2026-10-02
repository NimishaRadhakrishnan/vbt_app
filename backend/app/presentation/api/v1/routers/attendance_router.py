"""
Attendance Router endpoints.
"""

from __future__ import annotations

import uuid
from typing import Optional, Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.application.use_cases.attendance_use_case import AttendanceUseCase
from app.core.container import get_attendance_use_case
from app.presentation.api.v1.dependencies import CurrentUser
from app.presentation.api.v1.routers.consent_router import require_location_consent
from app.presentation.schemas.attendance_schemas import AttendanceResponse, CheckInRequest, CheckOutRequest

router = APIRouter(prefix="/attendance", tags=["attendance"])


@router.post("/check-in", response_model=AttendanceResponse, status_code=status.HTTP_201_CREATED)
async def check_in(
    payload: CheckInRequest,
    current_user: CurrentUser,
    use_case: Annotated[AttendanceUseCase, Depends(get_attendance_use_case)],
    _consent: Annotated[None, Depends(require_location_consent)] = None,
) -> AttendanceResponse:
    # Consent is enforced HERE, server-side, not only on the disclosure
    # screen. A client-side gate can be skipped by an older build, a
    # modified APK, or a plain bug - and the result would be a consent
    # log with holes in it and tracking running for some unknown subset
    # of officers. Gating the endpoint that starts tracking makes "we do
    # not track anyone who has not agreed" true by construction.
    #
    # Check-in ONLY. Check-out is deliberately never gated: an officer
    # who is already checked in and being tracked must always be able to
    # stop it, whatever their consent state. Gating check-out would trap
    # someone in exactly the situation the disclosure promises they can
    # leave.
    result = await use_case.check_in(
        user_id=current_user.user_id,
        device_id=payload.device_id,
        lat=payload.latitude,
        lng=payload.longitude,
        phone=payload.phone,
        is_fake_gps=payload.is_fake_gps,
        is_gps_disabled=payload.is_gps_disabled,
    )
    return AttendanceResponse(
        id=result.id,
        user_id=result.user_id,
        date=result.date,
        check_in_time=result.check_in_time,
        check_in_location_lat=result.check_in_location_lat,
        check_in_location_lng=result.check_in_location_lng,
        check_in_device_id=result.check_in_device_id,
        check_out_time=result.check_out_time,
        check_out_location_lat=result.check_out_location_lat,
        check_out_location_lng=result.check_out_location_lng,
        is_fake_gps=result.is_fake_gps,
        is_gps_disabled=result.is_gps_disabled,
    )


@router.post("/check-out", response_model=AttendanceResponse)
async def check_out(
    payload: CheckOutRequest,
    current_user: CurrentUser,
    use_case: Annotated[AttendanceUseCase, Depends(get_attendance_use_case)],
) -> AttendanceResponse:
    result = await use_case.check_out(
        user_id=current_user.user_id,
        lat=payload.latitude,
        lng=payload.longitude,
    )
    return AttendanceResponse(
        id=result.id,
        user_id=result.user_id,
        date=result.date,
        check_in_time=result.check_in_time,
        check_in_location_lat=result.check_in_location_lat,
        check_in_location_lng=result.check_in_location_lng,
        check_in_device_id=result.check_in_device_id,
        check_out_time=result.check_out_time,
        check_out_location_lat=result.check_out_location_lat,
        check_out_location_lng=result.check_out_location_lng,
        is_fake_gps=result.is_fake_gps,
        is_gps_disabled=result.is_gps_disabled,
    )


@router.get("/today", response_model=Optional[AttendanceResponse])
async def get_today(
    current_user: CurrentUser,
    use_case: Annotated[AttendanceUseCase, Depends(get_attendance_use_case)],
) -> Optional[AttendanceResponse]:
    result = await use_case.get_today_status(current_user.user_id)
    if not result:
        return None
    return AttendanceResponse(
        id=result.id,
        user_id=result.user_id,
        date=result.date,
        check_in_time=result.check_in_time,
        check_in_location_lat=result.check_in_location_lat,
        check_in_location_lng=result.check_in_location_lng,
        check_in_device_id=result.check_in_device_id,
        check_out_time=result.check_out_time,
        check_out_location_lat=result.check_out_location_lat,
        check_out_location_lng=result.check_out_location_lng,
        is_fake_gps=result.is_fake_gps,
        is_gps_disabled=result.is_gps_disabled,
    )


from datetime import date as date_type
from app.domain.repositories.user_repository import UserRepository
from app.core.container import get_user_repository

@router.get("", response_model=list[AttendanceResponse])
async def list_attendance(
    date: date_type,
    _current_user: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    use_case: Annotated[AttendanceUseCase, Depends(get_attendance_use_case)],
    user_repo: Annotated[UserRepository, Depends(get_user_repository)],
) -> list[AttendanceResponse]:
    records = await use_case.list_by_date(date)
    response = []
    for r in records:
        user = await user_repo.get_by_id(r.user_id)
        response.append(
            AttendanceResponse(
                id=r.id,
                user_id=r.user_id,
                date=r.date,
                check_in_time=r.check_in_time,
                check_in_location_lat=r.check_in_location_lat,
                check_in_location_lng=r.check_in_location_lng,
                check_in_device_id=r.check_in_device_id,
                check_out_time=r.check_out_time,
                check_out_location_lat=r.check_out_location_lat,
                check_out_location_lng=r.check_out_location_lng,
                is_fake_gps=r.is_fake_gps,
                is_gps_disabled=r.is_gps_disabled,
                user_name=user.full_name if user else "Unknown",
                user_role=user.role.value if user else "Unknown",
                employee_id=user.employee_id if user else "Unknown",
            )
        )
    return response


@router.get("/officer/{officer_id}", response_model=list[AttendanceResponse])
async def get_officer_attendance_history(
    officer_id: uuid.UUID,
    current_user: CurrentUser,
    use_case: Annotated[AttendanceUseCase, Depends(get_attendance_use_case)],
    user_repo: Annotated[UserRepository, Depends(get_user_repository)],
    limit: int = 60,
    offset: int = 0,
) -> list[AttendanceResponse]:
    """One officer's attendance history over time — powers the Officer 360
    profile's Attendance tab. Self-serve for your own record; admin/manager
    for anyone else, enforced server-side same as list_tasks's assigned_to
    filter."""
    is_privileged = current_user.role in (Role.ADMIN.value, Role.MANAGER.value)
    if officer_id != current_user.user_id and not is_privileged:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to view this officer's attendance.")

    records = await use_case.list_by_user(officer_id, limit=limit, offset=offset)
    user = await user_repo.get_by_id(officer_id)
    return [
        AttendanceResponse(
            id=r.id,
            user_id=r.user_id,
            date=r.date,
            check_in_time=r.check_in_time,
            check_in_location_lat=r.check_in_location_lat,
            check_in_location_lng=r.check_in_location_lng,
            check_in_device_id=r.check_in_device_id,
            check_out_time=r.check_out_time,
            check_out_location_lat=r.check_out_location_lat,
            check_out_location_lng=r.check_out_location_lng,
            is_fake_gps=r.is_fake_gps,
            is_gps_disabled=r.is_gps_disabled,
            user_name=user.full_name if user else "Unknown",
            user_role=user.role.value if user else "Unknown",
            employee_id=user.employee_id if user else "Unknown",
        )
        for r in records
    ]


from datetime import datetime, timedelta, timezone, time as time_type
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.infrastructure.config.company_time import company_today, company_tz
from app.infrastructure.database.session import get_db_session
from app.domain.value_objects.role import Role
from app.presentation.api.v1.dependencies import require_role


@router.get("/roster-status")
async def get_roster_status(
    _current_user: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[dict]:
    """
    Every field/sales officer for today, with whether they've checked in,
    whether that check-in was after 9:00 AM (late), and whether they've
    checked out — backs the "9AM login / 6PM monitoring window" dashboard
    view. Computed live from the attendance table rather than stored, so
    it's always accurate for "today" without a background job.
    """
    tz = company_tz()
    day_start = datetime.combine(company_today(), time_type.min, tzinfo=tz)
    day_end = day_start + timedelta(days=1)
    
    result = await session.execute(
        text("""
            SELECT u.id AS officer_id, u.full_name, u.role,
                   a.check_in_time, a.check_out_time
            FROM users u
            LEFT JOIN attendance a ON a.user_id = u.id 
                AND a.check_in_time >= :day_start 
                AND a.check_in_time < :day_end
            WHERE u.role IN ('field_officer', 'sales_officer') AND u.is_active = true AND u.is_deleted = false
            ORDER BY u.full_name
        """).bindparams(day_start=day_start, day_end=day_end)
    )
    rows = result.all()
    roster = []
    for r in rows:
        checked_in = r.check_in_time is not None
        is_late = False
        if checked_in:
            local_time = r.check_in_time.astimezone(timezone.utc).time() if r.check_in_time.tzinfo else r.check_in_time.time()
            is_late = local_time > time_type(9, 0)
        roster.append({
            "officer_id": str(r.officer_id),
            "full_name": r.full_name,
            "role": r.role,
            "checked_in": checked_in,
            "check_in_time": r.check_in_time.isoformat() if r.check_in_time else None,
            "is_late": is_late,
            "checked_out": r.check_out_time is not None,
        })
    return roster
