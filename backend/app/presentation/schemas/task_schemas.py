from pydantic import BaseModel, field_validator
from app.presentation.schemas.date_validators import validate_not_past
from typing import Optional
from datetime import date, datetime
import uuid


class TaskCreateRequest(BaseModel):
    title: str
    description: Optional[str] = None
    assigned_to: uuid.UUID
    due_date: date

    @field_validator("due_date", mode="after")
    @classmethod
    def check_due_date(cls, v):
        return validate_not_past(v)

    related_type: Optional[str] = None  # "farmer" | "dealer" | "crop_issue" | "general"
    related_id: Optional[uuid.UUID] = None


class TaskUpdateRequest(BaseModel):
    """Admin/manager edit of a task's core fields (not status — see TaskStatusUpdateRequest)."""
    title: Optional[str] = None
    description: Optional[str] = None
    assigned_to: Optional[uuid.UUID] = None
    due_date: Optional[date] = None

    @field_validator("due_date", mode="after")
    @classmethod
    def check_due_date(cls, v):
        return validate_not_past(v)


class TaskStatusUpdateRequest(BaseModel):
    status: str  # "assigned" | "in_progress" | "pending_review" | "cancelled" - NOT "done", see TaskReviewRequest
    proof_photo_url: Optional[str] = None
    proof_gps_lat: Optional[float] = None
    proof_gps_lng: Optional[float] = None


class TaskReviewRequest(BaseModel):
    """Admin/manager approval or rejection of a task currently in
    pending_review. Only valid transition target for status='done' -
    officers can't set that directly via TaskStatusUpdateRequest."""
    approve: bool
    rejection_reason: Optional[str] = None


class TaskResponse(BaseModel):
    id: uuid.UUID
    title: str
    description: Optional[str] = None
    assigned_to: uuid.UUID
    assigned_to_name: str
    assigned_by: Optional[uuid.UUID] = None
    assigned_by_name: Optional[str] = None
    due_date: date
    status: str
    is_overdue: bool
    related_type: Optional[str] = None
    related_id: Optional[uuid.UUID] = None
    proof_photo_url: Optional[str] = None
    proof_gps_lat: Optional[float] = None
    proof_gps_lng: Optional[float] = None
    reviewed_by: Optional[uuid.UUID] = None
    reviewed_by_name: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
