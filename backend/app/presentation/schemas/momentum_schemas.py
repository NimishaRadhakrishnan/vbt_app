"""
Momentum schemas.
"""
from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime
import uuid


class PersonalBestResponse(BaseModel):
    metric: str
    value: float
    achieved_period_start: date
    achieved_period_end: date


class BadgeResponse(BaseModel):
    code: str
    title: str
    description: Optional[str] = None
    metric: str
    threshold: int
    earned_at: Optional[datetime] = None


class KudosResponse(BaseModel):
    id: uuid.UUID
    from_user_id: uuid.UUID
    from_user_name: Optional[str] = None
    to_user_id: uuid.UUID
    task_id: Optional[uuid.UUID] = None
    message: Optional[str] = None
    created_at: datetime


class MomentumMeResponse(BaseModel):
    momentum_score: int
    monthly_tasks_completed: int
    monthly_task_target: int
    personal_bests: List[PersonalBestResponse]
    badges: List[BadgeResponse]
    recent_kudos: List[KudosResponse]
    # Period-over-period trend: this month so far vs. the same number of
    # elapsed days last month (a fair comparison, not partial-vs-full-month).
    # trend_direction is "up" | "steady" | "building" — never a leaderboard
    # rank, and "building" (rather than "down") is deliberately the label
    # for a lower count, per the no-negative-framing rule.
    previous_period_tasks_completed: int
    trend_direction: str
    trend_label: str


class MomentumTeamResponse(BaseModel):
    percent_hit_target: float
    team_badges_this_month: int
    personal_bests_this_week: int


class KudosCreateRequest(BaseModel):
    to_user_id: uuid.UUID
    task_id: Optional[uuid.UUID] = None
    message: Optional[str] = None


class MomentumTargetResponse(BaseModel):
    role: str
    monthly_task_target: int
    updated_at: datetime


class MomentumTargetUpdateRequest(BaseModel):
    monthly_task_target: int
