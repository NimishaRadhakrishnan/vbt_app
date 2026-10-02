"""
Daily Work Report Router.

Handles submission and listing of daily work reports for officers.
Uses the standard ORM, Domain Entity, and Repository layer pattern.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.exc import IntegrityError
from sqlalchemy import text

from app.core.container import (
    get_notification_repository,
    get_daily_work_report_repository,
    get_user_repository,
)
from app.domain.entities.notification import Notification
from app.domain.entities.daily_work_report import DailyWorkReport
from app.domain.repositories.notification_repository import NotificationRepository
from app.domain.repositories.daily_work_report_repository import DailyWorkReportRepository
from app.domain.repositories.user_repository import UserRepository
from app.domain.value_objects.role import Role
from app.infrastructure.database.session import get_db_session
from app.infrastructure.storage.local_file_storage import save_upload
from sqlalchemy.ext.asyncio import AsyncSession
from app.presentation.api.v1.dependencies import CurrentUser, require_role
from app.presentation.schemas.daily_report_schemas import (
    DailyReportCreateRequest,
    DailyReportResponse,
    DailyReportTodayStatusResponse,
)

router = APIRouter(prefix="/reports/daily", tags=["daily_reports"])


def _to_response(entity: DailyWorkReport) -> DailyReportResponse:
    return DailyReportResponse(
        id=entity.id,
        user_id=entity.user_id,
        officer_name=entity.officer_name,
        report_date=entity.report_date,
        summary=entity.summary,
        attachment_url=entity.attachment_url,
        created_at=entity.created_at,
    )


@router.post("", response_model=DailyReportResponse, status_code=status.HTTP_201_CREATED)
async def create_daily_report(
    payload: DailyReportCreateRequest,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    report_repo: Annotated[DailyWorkReportRepository, Depends(get_daily_work_report_repository)],
    notification_repo: Annotated[NotificationRepository, Depends(get_notification_repository)],
    user_repo: Annotated[UserRepository, Depends(get_user_repository)],
) -> DailyReportResponse:
    # Always compute report date securely on the server
    today = date.today()

    new_report = DailyWorkReport(
        user_id=current_user.user_id,
        report_date=today,
        summary=payload.summary,
        attachment_url=payload.attachment_url,
    )

    try:
        saved_report = await report_repo.add(new_report)
        await session.commit()
    except IntegrityError as e:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already submitted a daily report for today.",
        ) from e

    # Notify admins and managers
    admins_check = await session.execute(
        text("SELECT id FROM users WHERE role IN ('admin', 'manager') AND is_deleted = false")
    )
    admin_rows = admins_check.all()

    # User's own full name for the notification
    current_user_entity = await user_repo.get_by_id(current_user.user_id)
    officer_name = current_user_entity.full_name if current_user_entity else "An officer"

    for admin_row in admin_rows:
        await notification_repo.add(
            Notification(
                user_id=admin_row.id,
                title="Daily Report Submitted",
                message=f"{officer_name} has submitted their daily work report.",
                type="daily_report_submitted",
            )
        )

    return _to_response(saved_report)


@router.get("/today-status", response_model=DailyReportTodayStatusResponse)
async def get_today_status(
    current_user: CurrentUser,
    report_repo: Annotated[DailyWorkReportRepository, Depends(get_daily_work_report_repository)],
) -> DailyReportTodayStatusResponse:
    today = date.today()
    report = await report_repo.get_by_user_and_date(current_user.user_id, today)
    
    if report:
        return DailyReportTodayStatusResponse(submitted_today=True, report_id=report.id)
    return DailyReportTodayStatusResponse(submitted_today=False)


@router.get("", response_model=list[DailyReportResponse])
async def list_daily_reports(
    _current_user: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    report_repo: Annotated[DailyWorkReportRepository, Depends(get_daily_work_report_repository)],
    user_id: Optional[uuid.UUID] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[DailyReportResponse]:
    
    reports = await report_repo.list_reports(
        user_id=user_id,
        from_date=from_date,
        to_date=to_date,
        limit=limit,
        offset=offset
    )
    return [_to_response(r) for r in reports]


@router.post("/upload")
async def upload_file(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    file: UploadFile = File(...)
):
    url = await save_upload(file, current_user.user_id, session)
    return {"url": url}
