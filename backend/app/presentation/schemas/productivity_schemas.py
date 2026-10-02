from pydantic import BaseModel
from typing import Optional
from datetime import date
import uuid


class TrendDataPoint(BaseModel):
    label: str
    tasks: int
    visits: int

class ProductivitySummary(BaseModel):
    officer_id: uuid.UUID
    officer_name: str
    officer_role: str
    period: str  # "daily" | "weekly" | "monthly"
    period_start: date
    period_end: date
    tasks_assigned: int
    tasks_completed: int
    task_completion_rate: Optional[float] = None
    days_present: int
    weekly_plans_submitted: int
    weekly_plans_approved: int
    crop_issues_resolved: int
    visits_completed: int
    
    # New fields for trend and comparisons
    previous_tasks_completed: Optional[int] = None
    previous_days_present: Optional[int] = None
    previous_crop_issues_resolved: Optional[int] = None
    previous_visits_completed: Optional[int] = None
    trend_data: Optional[list[TrendDataPoint]] = None
