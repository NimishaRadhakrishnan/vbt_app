from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, Field


# --- Audit trail (section 3: "who changed what, when") ---
class AuditLogResponse(BaseModel):
    id: uuid.UUID
    user_id: Optional[uuid.UUID] = None
    actor_name: Optional[str] = None
    event_type: str
    description: str
    context_data: dict[str, Any]
    created_at: datetime


# --- Farmer admin edit (Field Network) ---
class AdminFarmerUpdateRequest(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    village: Optional[str] = None
    taluk: Optional[str] = None
    district: Optional[str] = None
    crop: Optional[str] = None
    cents: Optional[float] = None


# --- Dealer admin edit (Field Network) ---
class AdminDealerUpdateRequest(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    village: Optional[str] = None
    taluk: Optional[str] = None
    district: Optional[str] = None
    address: Optional[str] = None
    contact_person: Optional[str] = None
    alternate_contact: Optional[str] = None
    state: Optional[str] = None
    pin_code: Optional[str] = None
    gst_number: Optional[str] = None
    dealer_type: Optional[str] = None
    remarks: Optional[str] = None
    assigned_sales_officer_id: Optional[uuid.UUID] = None


# --- Product admin CRUD (previously nothing but a read-only catalog) ---
class AdminProductCreateRequest(BaseModel):
    name: str
    category: str
    sku_code: str
    price: float = Field(gt=0)
    description: Optional[str] = None


class AdminProductUpdateRequest(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    sku_code: Optional[str] = None
    price: Optional[float] = Field(default=None, gt=0)
    description: Optional[str] = None
    is_active: Optional[bool] = None


class AdminProductResponse(BaseModel):
    id: uuid.UUID
    name: str
    category: str
    sku_code: str
    price: float
    description: Optional[str] = None
    is_active: bool
    updated_by: Optional[uuid.UUID] = None
    updated_by_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Bulk product entry, and price bands by quantity and dealer.
#
# Two sheets, each doing one job, because they are filled in at different
# times by different people: the catalog is set up once, and the price sheet
# is revised whenever rates move. Mixing them into one upload would mean
# retyping every product's details to change one rate.
#
# Both uploads are all-or-nothing and both support a dry run, so the operator
# sees what would happen before anything is written. A half-applied price
# sheet is worse than a rejected one: nobody can tell which products are now
# priced wrongly, and the dealer finds out first.
# ---------------------------------------------------------------------------
class BulkProductRow(BaseModel):
    """One product. ``row_number`` is echoed back on failure so the operator
    can find the line in their spreadsheet rather than counting."""

    row_number: Optional[int] = None
    name: str = Field(min_length=1, max_length=200)
    category: str = Field(min_length=1, max_length=100)
    sku_code: str = Field(min_length=1, max_length=100)
    price: Decimal = Field(gt=0, description="List price. Quantity bands are set separately.")
    description: Optional[str] = None


class BulkProductRequest(BaseModel):
    rows: list[BulkProductRow] = Field(min_length=1, max_length=2000)
    dry_run: bool = Field(
        default=False,
        description="Validate every row and report, without saving anything.",
    )


class BulkPriceTierRow(BaseModel):
    """One price band.

    ``max_quantity`` left null means the band is open at the top - "51 and
    above". ``dealer_id`` left null means the band applies to every dealer;
    set it to price one dealer differently for the same quantities.

    Products are identified by SKU rather than id, because the person filling
    in the sheet has the SKU in front of them and not a UUID.
    """

    row_number: Optional[int] = None
    sku_code: Optional[str] = None
    product_id: Optional[uuid.UUID] = None
    dealer_id: Optional[uuid.UUID] = None
    dealer_phone: Optional[str] = Field(
        default=None,
        description="Alternative to dealer_id - the phone number the dealer is registered under.",
    )
    min_quantity: int = Field(ge=1)
    max_quantity: Optional[int] = Field(default=None, ge=1)
    price: Decimal = Field(gt=0)
    note: Optional[str] = Field(default=None, max_length=200)


class BulkPriceTierRequest(BaseModel):
    rows: list[BulkPriceTierRow] = Field(min_length=1, max_length=2000)
    dry_run: bool = False


class BulkRowError(BaseModel):
    row_number: int
    error: str


class BulkImportResponse(BaseModel):
    applied: int
    rejected: int
    errors: list[BulkRowError] = []
    dry_run: bool = False
    would_apply: Optional[int] = None
    message: str


class PriceTierCreateRequest(BaseModel):
    product_id: uuid.UUID
    dealer_id: Optional[uuid.UUID] = None
    min_quantity: int = Field(ge=1)
    max_quantity: Optional[int] = Field(default=None, ge=1)
    price: Decimal = Field(gt=0)
    note: Optional[str] = Field(default=None, max_length=200)


class PriceTierUpdateRequest(BaseModel):
    min_quantity: Optional[int] = Field(default=None, ge=1)
    max_quantity: Optional[int] = Field(default=None, ge=1)
    price: Optional[Decimal] = Field(default=None, gt=0)
    note: Optional[str] = Field(default=None, max_length=200)


class PriceTierResponse(BaseModel):
    id: uuid.UUID
    product_id: uuid.UUID
    product_name: Optional[str] = None
    sku_code: Optional[str] = None
    dealer_id: Optional[uuid.UUID] = None
    dealer_name: Optional[str] = None
    min_quantity: int
    max_quantity: Optional[int] = None
    price: Decimal
    band_label: str
    note: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class PriceQuoteResponse(BaseModel):
    """What a quantity actually costs, and why it costs that.

    ``source`` and ``band_label`` are returned so a screen can show the reason
    beside the number. An officer who can see "quantity rate, 11-50 units" has
    something to tell the dealer; a bare figure they have to take on trust is
    what gets argued about at the counter.
    """

    product_id: uuid.UUID
    dealer_id: Optional[uuid.UUID] = None
    quantity: int
    unit_price: Decimal
    line_total: Decimal
    source: str
    source_label: str
    band_label: str
    note: Optional[str] = None


# --- Leave request admin edit (beyond the existing approve/reject decision) ---
class AdminLeaveUpdateRequest(BaseModel):
    leave_type: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    reason: Optional[str] = None
    status: Optional[str] = None  # pending | approved | rejected


# --- Crop issue admin edit ---
class AdminCropIssueUpdateRequest(BaseModel):
    description: Optional[str] = None
    district: Optional[str] = None
    status: Optional[str] = None  # open | resolved
    solution: Optional[str] = None


# --- Annual target + monthly weighting (shared by section 2's dashboard
# widget and section 5's KPI rollup) ---
class AnnualTargetResponse(BaseModel):
    role: str
    year: int
    metric: str
    annual_value: float
    updated_at: datetime


class AnnualTargetUpdateRequest(BaseModel):
    year: int
    metric: str = "tasks_completed"
    annual_value: float = Field(gt=0)


class MonthlyWeightEntry(BaseModel):
    month: int = Field(ge=1, le=12)
    weight: float = Field(ge=0, le=1)


class MonthlyWeightsResponse(BaseModel):
    role: str
    metric: str
    weights: list[MonthlyWeightEntry]


class MonthlyWeightsUpdateRequest(BaseModel):
    metric: str = "tasks_completed"
    weights: list[MonthlyWeightEntry] = Field(min_length=12, max_length=12)
