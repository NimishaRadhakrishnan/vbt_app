from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid


class EnquiryCreateRequest(BaseModel):
    # Deliberately no farmer name/phone/address — this flow exists for
    # farmers who don't want to share those details.
    district: Optional[str] = None
    description: str
    image_url: Optional[str] = None


class EnquiryResolveRequest(BaseModel):
    solution: str


class EnquiryResponse(BaseModel):
    id: uuid.UUID
    reported_by: uuid.UUID
    reported_by_name: str
    district: Optional[str] = None
    description: str
    image_url: Optional[str] = None
    status: str
    solution: Optional[str] = None
    resolved_by: Optional[uuid.UUID] = None
    resolved_by_name: Optional[str] = None
    resolved_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
