from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid


class HRPolicyResponse(BaseModel):
    id: uuid.UUID
    section: str
    title: str
    content: str
    display_order: int
    updated_at: datetime


class HRPolicyUpdateRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    display_order: Optional[int] = None
