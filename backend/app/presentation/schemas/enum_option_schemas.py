from pydantic import BaseModel, Field
from typing import Optional
import uuid
from datetime import datetime


class EnumOptionResponse(BaseModel):
    id: uuid.UUID
    field_name: str
    value: str
    label: str
    display_order: int
    is_active: bool
    # Drives the "Please specify" input on every web and mobile form.
    requires_description: bool = False
    usage_count: Optional[int] = None
    updated_at: datetime


class EnumOptionCreateRequest(BaseModel):
    value: str = Field(min_length=1, max_length=50, pattern=r"^[a-z0-9_]+$")
    label: str = Field(min_length=1, max_length=200)
    # Lets an admin mark a NEW option (e.g. "Miscellaneous") as needing
    # a description, which a hardcoded 'other' check could never cover.
    requires_description: bool = False


class EnumOptionUpdateRequest(BaseModel):
    requires_description: Optional[bool] = None
    # value is deliberately not editable after creation - it's what's
    # actually stored in existing visit_health/visit_trial_details/visits
    # rows, so silently changing it would rewrite what those historical
    # records mean. Only label and order are safe to change freely.
    label: Optional[str] = Field(default=None, min_length=1, max_length=200)


class EnumOptionReorderItem(BaseModel):
    id: uuid.UUID
    display_order: int


class EnumOptionReorderRequest(BaseModel):
    items: list[EnumOptionReorderItem]
