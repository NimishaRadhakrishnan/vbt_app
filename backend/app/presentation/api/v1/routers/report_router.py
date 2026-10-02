"""
Report generation endpoints router.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import StreamingResponse

from app.application.use_cases.report_use_case import ReportUseCase
from app.core.container import get_report_use_case
from app.domain.value_objects.role import Role
from app.presentation.api.v1.dependencies import require_role

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/attendance/pdf")
async def get_attendance_pdf(
    date_val: date,
    _current_user: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    use_case: Annotated[ReportUseCase, Depends(get_report_use_case)],
) -> StreamingResponse:
    pdf_buffer = await use_case.generate_attendance_pdf(date_val)
    return StreamingResponse(
        pdf_buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=attendance_report_{date_val}.pdf"},
    )


@router.get("/farmers/excel")
async def get_farmers_excel(
    _current_user: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    use_case: Annotated[ReportUseCase, Depends(get_report_use_case)],
) -> StreamingResponse:
    excel_buffer = await use_case.generate_farmer_excel()
    return StreamingResponse(
        excel_buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=farmer_directory.xlsx"},
    )
