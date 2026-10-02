from pydantic import BaseModel, Field
from typing import Optional, Any
import uuid
from datetime import datetime


class CustomFieldOption(BaseModel):
    value: str
    label: str


class CustomFieldDefinitionResponse(BaseModel):
    id: uuid.UUID
    form_key: str
    field_key: str
    section: str
    label: str
    placeholder: Optional[str] = None
    help_text: Optional[str] = None
    field_type: str
    options: Optional[list[CustomFieldOption]] = None
    is_required: bool
    is_enabled: bool
    display_order: int
    visible_to_field_officer: bool
    visible_to_sales_officer: bool
    visible_to_manager: bool
    default_value: Optional[str] = None
    updated_at: datetime


class CustomFieldConfigResponse(BaseModel):
    version: int
    fields: list[CustomFieldDefinitionResponse]


class CustomFieldCreateRequest(BaseModel):
    section: str = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=200)
    placeholder: Optional[str] = None
    help_text: Optional[str] = None
    field_type: str  # text | number | date | select | multiselect | radio | checkbox | textarea | file
    options: Optional[list[CustomFieldOption]] = None
    is_required: bool = False
    visible_to_field_officer: bool = True
    visible_to_sales_officer: bool = True
    visible_to_manager: bool = False
    default_value: Optional[str] = None


class CustomFieldUpdateRequest(BaseModel):
    section: Optional[str] = None
    label: Optional[str] = None
    placeholder: Optional[str] = None
    # Editable after creation: an admin who picked the wrong type
    # otherwise had to delete the field and lose any answers already
    # collected against it.
    field_type: Optional[str] = None
    help_text: Optional[str] = None
    options: Optional[list[CustomFieldOption]] = None
    is_required: Optional[bool] = None
    is_enabled: Optional[bool] = None
    visible_to_field_officer: Optional[bool] = None
    visible_to_sales_officer: Optional[bool] = None
    visible_to_manager: Optional[bool] = None
    default_value: Optional[str] = None


class CustomFieldReorderItem(BaseModel):
    field_key: str
    display_order: int


class CustomFieldReorderRequest(BaseModel):
    items: list[CustomFieldReorderItem]


class CustomFieldAnswersSubmitRequest(BaseModel):
    # {field_key: value} - value is deliberately Any (JSONB-backed) since
    # a custom field's value shape depends entirely on its field_type
    # (a string, a number, an array for multiselect/checkbox, etc.) -
    # there's no fixed schema to validate against, by definition, since
    # these fields don't exist until an Admin defines them.
    answers: dict[str, Any]


class CustomFieldAnswerResponse(BaseModel):
    field_key: str
    value: Any
