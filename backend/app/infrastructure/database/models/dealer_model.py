"""
Dealer and Inventory database models.
"""

from __future__ import annotations
from typing import Optional

import uuid
from datetime import date, datetime

from geoalchemy2 import Geography
from sqlalchemy import Boolean, Date, DateTime, Double, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.infrastructure.database.models.base_model import TimestampedUUIDMixin
from app.infrastructure.database.session import Base


class DealerModel(TimestampedUUIDMixin, Base):
    __tablename__ = "dealers"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    district: Mapped[str] = mapped_column(String(100), nullable=False)
    village: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    taluk: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    location: Mapped[Optional[str]] = mapped_column(Geography(geometry_type="POINT", srid=4326), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    contact_person: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    alternate_contact: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    pin_code: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    gst_number: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    dealer_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    remarks: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    assigned_sales_officer_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(30), default="active", nullable=False)
    requested_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")


class ProductModel(TimestampedUUIDMixin, Base):
    __tablename__ = "products"

    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    sku_code: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    price: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    # What the product costs the company. Nullable, and left NULL until
    # somebody enters the real figure: profit is reported only where this
    # exists, because treating an unknown cost as zero would report a 100%
    # margin on every product nobody has costed yet. See migration
    # 202609300002.
    cost_price: Mapped[Optional[float]] = mapped_column(Numeric(12, 2), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")


class ProductPriceTierModel(TimestampedUUIDMixin, Base):
    """One price for one quantity band, optionally only for one dealer.

    A NULL ``dealer_id`` means the band applies to every dealer. A NULL
    ``max_quantity`` means the band is open at the top ("51 and above").

    Overlapping bands for the same product and dealer are refused by the
    database (``ex_price_tier_no_overlap``), not by code here — see migration
    202609300001. That matters: without it the price of 7 units would depend
    on which row a query happened to reach first.
    """

    __tablename__ = "product_price_tiers"

    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    dealer_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("dealers.id", ondelete="CASCADE"), nullable=True
    )
    min_quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    max_quantity: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    price: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    note: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class DealerStockModel(TimestampedUUIDMixin, Base):
    __tablename__ = "dealer_stocks"

    dealer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("dealers.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    stock_qty: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    low_stock_threshold: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    last_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class DealerOrderModel(TimestampedUUIDMixin, Base):
    __tablename__ = "dealer_orders"

    dealer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("dealers.id", ondelete="CASCADE"), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="draft", nullable=False)
    total_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0, nullable=False)
    comments: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    order_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    payment_deadline: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    payment_terms: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    items: Mapped[list[OrderItemModel]] = relationship(
        "OrderItemModel", back_populates="order", cascade="all, delete-orphan", lazy="selectin"
    )


class OrderItemModel(TimestampedUUIDMixin, Base):
    __tablename__ = "order_items"

    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("dealer_orders.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)

    order: Mapped[DealerOrderModel] = relationship("DealerOrderModel", back_populates="items")


class StockMovementModel(TimestampedUUIDMixin, Base):
    __tablename__ = "stock_movements"

    dealer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("dealers.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    movement_type: Mapped[str] = mapped_column(String(30), nullable=False)  # inbound_order, sales_out, stock_adjustment, return
    notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)