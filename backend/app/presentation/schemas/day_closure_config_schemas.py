from pydantic import BaseModel
from typing import Optional
import uuid
from datetime import datetime


class FieldConfigResponse(BaseModel):
    id: uuid.UUID
    field_key: str
    section: str
    label: str
    placeholder: Optional[str] = None
    help_text: Optional[str] = None
    field_type: str
    is_required: bool
    is_enabled: bool
    display_order: int
    visible_to_field_officer: bool
    visible_to_sales_officer: bool
    default_value: Optional[str] = None
    backend_required: bool
    updated_at: datetime


class FieldConfigUpdateRequest(BaseModel):
    # All optional - a PUT only changes what's provided, matching the
    # partial-update pattern already used elsewhere in admin_router.py.
    label: Optional[str] = None
    placeholder: Optional[str] = None
    help_text: Optional[str] = None
    is_required: Optional[bool] = None
    is_enabled: Optional[bool] = None
    visible_to_field_officer: Optional[bool] = None
    visible_to_sales_officer: Optional[bool] = None
    default_value: Optional[str] = None


class FieldConfigReorderItem(BaseModel):
    field_key: str
    display_order: int


class FieldConfigReorderRequest(BaseModel):
    items: list[FieldConfigReorderItem]


class SectionResponse(BaseModel):
    id: uuid.UUID
    section_key: str
    label: str
    display_order: int
    is_original: bool


class SectionCreateRequest(BaseModel):
    label: str


class SectionUpdateRequest(BaseModel):
    label: str


class SectionReorderItem(BaseModel):
    section_key: str
    display_order: int


class SectionReorderRequest(BaseModel):
    items: list[SectionReorderItem]
