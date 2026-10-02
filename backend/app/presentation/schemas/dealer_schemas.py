"""
Dealer and Inventory Pydantic schemas.
"""

from __future__ import annotations
from typing import Optional

import uuid
from datetime import date, datetime
from pydantic import BaseModel, Field, field_validator
from app.presentation.schemas.date_validators import validate_not_past


class RegisterDealerRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=10, max_length=50)
    district: str = Field(min_length=1, max_length=100)
    village: Optional[str] = Field(default=None, max_length=100)
    taluk: Optional[str] = Field(default=None, max_length=100)
    location_lat: Optional[float] = Field(default=None, ge=-90.0, le=90.0)
    location_lng: Optional[float] = Field(default=None, ge=-180.0, le=180.0)
    address: Optional[str] = None
    contact_person: Optional[str] = Field(default=None, max_length=150)
    alternate_contact: Optional[str] = Field(default=None, max_length=50)
    state: Optional[str] = Field(default=None, max_length=100)
    pin_code: Optional[str] = Field(default=None, max_length=10)
    gst_number: Optional[str] = Field(default=None, max_length=20)
    dealer_type: Optional[str] = Field(default=None, max_length=50)
    remarks: Optional[str] = Field(default=None, max_length=1000)
    # Confirms the officer has already seen and dismissed the duplicate
    # check (section 4) - without this, the create endpoint re-runs the
    # same possible-duplicate search server-side and blocks with a 409
    # rather than trusting the client skipped the check.
    duplicate_check_acknowledged: bool = False


class DealerResponse(BaseModel):
    id: uuid.UUID
    name: str
    phone: str
    district: str
    village: Optional[str] = None
    taluk: Optional[str] = None
    location_lat: Optional[float] = None
    location_lng: Optional[float] = None
    address: Optional[str] = None
    contact_person: Optional[str] = None
    alternate_contact: Optional[str] = None
    state: Optional[str] = None
    pin_code: Optional[str] = None
    gst_number: Optional[str] = None
    dealer_type: Optional[str] = None
    remarks: Optional[str] = None
    assigned_sales_officer_id: Optional[uuid.UUID] = None
    status: str = "active"
    requested_by: Optional[uuid.UUID] = None
    created_at: datetime


class PossibleDuplicateDealer(BaseModel):
    id: uuid.UUID
    name: str
    phone: str
    district: str
    village: Optional[str] = None
    gst_number: Optional[str] = None
    match_reason: str  # "phone" | "gst_number" | "name_and_district"


class DuplicateCheckResponse(BaseModel):
    has_possible_duplicates: bool
    candidates: list[PossibleDuplicateDealer]


class DealerApprovalRequest(BaseModel):
    approve: bool


class StockAuditRequest(BaseModel):
    product_id: uuid.UUID
    stock_qty: int = Field(ge=0)
    notes: Optional[str] = None


class DealerStockResponse(BaseModel):
    id: uuid.UUID
    dealer_id: uuid.UUID
    product_id: uuid.UUID
    stock_qty: int
    low_stock_threshold: int
    last_updated_at: datetime


class OrderItemInput(BaseModel):
    product_id: uuid.UUID
    quantity: int = Field(gt=0)


class PlaceOrderRequest(BaseModel):
    items: list[OrderItemInput] = Field(min_length=1)
    comments: Optional[str] = None
    payment_deadline: Optional[date] = None

    @field_validator("payment_deadline", mode="after")
    @classmethod
    def check_deadline(cls, v):
        return validate_not_past(v)
    payment_terms: Optional[str] = Field(default=None, max_length=200)
    # Optional payment recorded at the moment of order creation - many
    # dealers pay something on the spot rather than nothing at all
    # (section 6/7's example even shows a paid amount alongside the
    # order). Creates the order's very first dealer_payments row in the
    # same request rather than forcing a separate immediate follow-up call.
    initial_payment_amount: Optional[float] = Field(default=None, ge=0)
    initial_payment_method: Optional[str] = None


class OrderItemResponse(BaseModel):
    id: uuid.UUID
    product_id: uuid.UUID
    quantity: int
    unit_price: float


class DealerOrderResponse(BaseModel):
    id: uuid.UUID
    dealer_id: uuid.UUID
    created_by: uuid.UUID
    status: str
    total_amount: float
    comments: Optional[str]
    payment_deadline: Optional[date] = None
    payment_terms: Optional[str] = None
    # Always computed from dealer_payments (SUM), never stored - section 7's
    # explicit "do not rely on manual entry" requirement.
    amount_paid: float = 0.0
    outstanding_amount: float = 0.0
    payment_status: str = "paid"  # upcoming | due_today | overdue | paid
    order_date: datetime
    items: list[OrderItemResponse]
    created_at: datetime


class ProductResponse(BaseModel):
    id: uuid.UUID
    name: str
    category: str
    sku_code: str
    price: float
    description: Optional[str]