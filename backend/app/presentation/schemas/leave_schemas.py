from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
import uuid


class LeaveRequestCreate(BaseModel):
    leave_type: str  # "planned" | "emergency"
    start_date: date
    end_date: date
    reason: str


class LeaveRequestDecision(BaseModel):
    approve: bool
    decision_notes: Optional[str] = None


class LeaveRequestResponse(BaseModel):
    id: uuid.UUID
    officer_id: uuid.UUID
    officer_name: str
    leave_type: str
    start_date: date
    end_date: date
    reason: str
    status: str
    decided_by: Optional[uuid.UUID] = None
    decided_by_name: Optional[str] = None
    decided_at: Optional[datetime] = None
    decision_notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
