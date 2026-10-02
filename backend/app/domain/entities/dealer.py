"""
Dealer and Inventory domain entities.
"""

from __future__ import annotations
from typing import Optional

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime


@dataclass
class Dealer:
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
    status: str = "active"  # pending_approval, active, rejected
    requested_by: Optional[uuid.UUID] = None
    updated_by: Optional[uuid.UUID] = None
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class Product:
    name: str
    category: str
    sku_code: str
    price: float
    description: Optional[str] = None
    is_active: bool = True
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class DealerStock:
    dealer_id: uuid.UUID
    product_id: uuid.UUID
    stock_qty: int
    low_stock_threshold: int = 10
    updated_by: Optional[uuid.UUID] = None
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    last_updated_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class OrderItem:
    product_id: uuid.UUID
    quantity: int
    unit_price: float
    id: uuid.UUID = field(default_factory=uuid.uuid4)


@dataclass
class DealerOrder:
    dealer_id: uuid.UUID
    created_by: uuid.UUID
    status: str = "draft"  # draft, submitted, approved, packed, dispatched, delivered, cancelled
    items: list[OrderItem] = field(default_factory=list)
    total_amount: float = 0.0
    comments: Optional[str] = None
    payment_deadline: Optional[date] = None
    payment_terms: Optional[str] = None
    order_date: datetime = field(default_factory=datetime.utcnow)
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class StockMovement:
    dealer_id: uuid.UUID
    product_id: uuid.UUID
    quantity: int
    movement_type: str  # inbound_order, sales_out, stock_adjustment, return
    notes: Optional[str] = None
    updated_by: Optional[uuid.UUID] = None  # who recorded this movement (mixin column; row is insert-only)
    recorded_at: datetime = field(default_factory=datetime.utcnow)
    id: uuid.UUID = field(default_factory=uuid.uuid4)