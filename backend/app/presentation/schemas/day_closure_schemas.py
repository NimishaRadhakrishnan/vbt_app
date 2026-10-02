from pydantic import BaseModel, Field
from typing import Optional, Any
from datetime import date, datetime
import uuid


class DayClosureStatusResponse(BaseModel):
    """Whether today's closure has already been submitted — used to gate logout."""
    closed_today: bool
    closure_id: Optional[uuid.UUID] = None
    visit_id: Optional[uuid.UUID] = None
    farmer_name: Optional[str] = None
    village: Optional[str] = None
    crop_name: Optional[str] = None


class DayClosureAdminResponse(BaseModel):
    id: uuid.UUID
    officer_id: uuid.UUID
    officer_name: str
    date: date
    # Lets Admin distinguish a genuine "no activity" day from a normal
    # closure at a glance, rather than inferring it from empty fields.
    closure_type: Optional[str] = None
    no_activity_reason: Optional[str] = None
    visit_id: Optional[uuid.UUID] = None
    farmer_name: Optional[str] = None
    village: Optional[str] = None
    district: Optional[str] = None
    crop_name: Optional[str] = None
    crop_status: Optional[str] = None
    demo_status: Optional[str] = None
    purchased: Optional[bool] = None
    order_value: Optional[float] = None
    created_at: datetime
    # Full satellite detail (pests, diseases, chemicals, photos, etc.) -
    # same shape _assemble_visit_detail() already returns for Daily Visit
    visit_detail: Optional[dict[str, Any]] = None
    custom_field_answers: Optional[dict[str, Any]] = None


class MissingClosureOfficer(BaseModel):
    officer_id: uuid.UUID
    officer_name: str
    role: str


# --- Sales Officer day closure (202608260017) ---

class SalesClosureImageInput(BaseModel):
    image_url: str
    image_type: Optional[str] = None  # dealer_shop | competitor | other


class SalesClosureSubmitRequest(BaseModel):
    """A Sales Officer's end-of-day record: dealers, orders, collection,
    stock and market intelligence.

    Only the three fields the backend genuinely cannot store a null for
    are required here (district, dealer_name, visit_purpose). Everything
    else is optional at the schema level even where the source form
    marks it required, because required-ness for those is now ADMIN
    CONFIGURABLE through day_closure_field_configs - hard-coding it in
    Pydantic too would mean an admin could turn a field off in the
    Builder and still have submissions rejected for omitting it.
    """
    district: str = Field(min_length=1, max_length=100)
    dealer_name: str = Field(min_length=1, max_length=200)
    visit_purpose: str = Field(min_length=1, max_length=50)
    # Required when the chosen purpose has requires_description = true
    # (enforced server-side, not by this schema, because which options
    # need it is admin-configurable data rather than a fixed list).
    visit_purpose_other_text: Optional[str] = Field(default=None, max_length=300)

    visit_date: Optional[date] = None
    dealer_id: Optional[uuid.UUID] = None
    village: Optional[str] = Field(default=None, max_length=200)
    dealer_contact: Optional[str] = Field(default=None, max_length=50)
    order_booked: Optional[bool] = None
    order_value: Optional[float] = Field(default=None, ge=0)
    amount_collected: Optional[float] = Field(default=None, ge=0)
    new_dealer_details: Optional[str] = None
    reviewed_fo_visit: Optional[bool] = None
    competitor_activity: Optional[str] = None
    stock_status: Optional[str] = Field(default=None, max_length=30)
    day_rating: Optional[int] = Field(default=None, ge=1, le=5)
    remarks: Optional[str] = None
    images: list[SalesClosureImageInput] = Field(default_factory=list)
    config_version: Optional[int] = None
    custom_field_answers: Optional[dict[str, Any]] = None


class SalesClosureResponse(BaseModel):
    id: uuid.UUID
    closure_id: uuid.UUID
    officer_id: uuid.UUID
    officer_name: Optional[str] = None
    date: date
    district: str
    dealer_name: str
    village: Optional[str] = None
    dealer_contact: Optional[str] = None
    visit_purpose: str
    visit_purpose_other_text: Optional[str] = None
    order_booked: Optional[bool] = None
    order_value: Optional[float] = None
    amount_collected: Optional[float] = None
    new_dealer_details: Optional[str] = None
    reviewed_fo_visit: Optional[bool] = None
    competitor_activity: Optional[str] = None
    stock_status: Optional[str] = None
    day_rating: Optional[int] = None
    remarks: Optional[str] = None
    created_at: datetime
    images: list[str] = Field(default_factory=list)
    custom_field_answers: Optional[dict[str, Any]] = None
