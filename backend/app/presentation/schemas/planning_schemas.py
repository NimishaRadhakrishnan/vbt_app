"""
Weekly Planning Pydantic schemas.
"""

from __future__ import annotations
from typing import Optional

import uuid
from datetime import date, datetime
from pydantic import BaseModel, Field, field_validator
from app.presentation.schemas.date_validators import validate_current_week_or_later


class PlanActivityInput(BaseModel):
    date: date

    @field_validator("date", mode="after")
    @classmethod
    def check_date(cls, v):
        return validate_current_week_or_later(v)

    territory_id: uuid.UUID
    activity_type: str = Field(min_length=1, max_length=100)
    planned_villages: list[str] = Field(default_factory=list)
    planned_dealers: list[str] = Field(default_factory=list)
    description: Optional[str] = None


class WeeklyPlanSubmitRequest(BaseModel):
    week_start_date: date

    @field_validator("week_start_date", mode="after")
    @classmethod
    def check_week_start_date(cls, v):
        return validate_current_week_or_later(v)

    activities: list[PlanActivityInput] = Field(min_length=1)


class PlanApproveRequest(BaseModel):
    approve: bool
    comment: Optional[str] = None


class PlanDeviationRequest(BaseModel):
    date: date
    reason: str = Field(min_length=1, max_length=50)  # Rain, Farmer unavailable, Emergency, Vehicle issue, Medical, Other
    details: str = Field(min_length=1)


class PlanActivityResponse(BaseModel):
    id: uuid.UUID
    date: date
    territory_id: uuid.UUID
    activity_type: str
    planned_villages: list[str]
    planned_dealers: list[str]
    description: Optional[str]


class PlanDeviationResponse(BaseModel):
    id: uuid.UUID
    date: date
    reason: str
    details: str
    recorded_at: datetime


class WeeklyPlanResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    week_start_date: date
    status: str
    approved_by: Optional[uuid.UUID] = None
    approved_at: Optional[datetime] = None
    manager_comment: Optional[str] = None
    activities: list[PlanActivityResponse]
    deviations: list[PlanDeviationResponse]
    created_at: datetime
    updated_at: datetime