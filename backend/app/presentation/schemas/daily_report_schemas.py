from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field

class DailyReportCreateRequest(BaseModel):
    summary: str = Field(..., description="A short report of the day's work.")
    attachment_url: Optional[str] = Field(None, description="Optional URL to an attached document or image.")

class DailyReportResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    officer_name: Optional[str] = None
    report_date: date
    summary: str
    attachment_url: Optional[str] = None
    created_at: datetime

class DailyReportTodayStatusResponse(BaseModel):
    submitted_today: bool
    report_id: Optional[uuid.UUID] = None
