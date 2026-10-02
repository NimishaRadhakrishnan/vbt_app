"""
Farmer Pydantic schemas.
"""

from __future__ import annotations
from typing import Optional

import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class TrialProductEntry(BaseModel):
    product_id: uuid.UUID
    quantity: float = Field(gt=0.0)


class RegisterFarmerRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=10, max_length=50)
    village: str = Field(min_length=1, max_length=100)
    taluk: str = Field(min_length=1, max_length=100)
    district: str = Field(min_length=1, max_length=100)
    crop: str = Field(min_length=1, max_length=100)
    cents: float = Field(gt=0.0)
    location_lat: Optional[float] = Field(default=None, ge=-90.0, le=90.0)
    location_lng: Optional[float] = Field(default=None, ge=-180.0, le=180.0)
    photo_url: Optional[str] = None
    # Field Officer's "Trial Conducted?" section - Section 5's own stock
    # rules apply: each product_id must have enough remaining
    # officer_product_stock or the whole registration is rejected (see
    # farmer_router.py's register_farmer for the transactional check).
    trial_conducted: bool = False
    trial_products: list[TrialProductEntry] = Field(default_factory=list)


class TrialProductDetail(BaseModel):
    product_id: uuid.UUID
    product_name: str
    quantity: float


class TrialUpdateRequest(BaseModel):
    trial_conducted: bool
    trial_products: list[TrialProductEntry] = Field(default_factory=list)


class FarmerResponse(BaseModel):
    id: uuid.UUID
    name: str
    phone: str
    village: str
    taluk: str
    district: str
    crop: str
    cents: float
    location_lat: Optional[float] = None
    location_lng: Optional[float] = None
    photo_url: Optional[str] = None
    created_by: Optional[uuid.UUID] = None
    trial_conducted: bool = False
    trial_products: list[TrialProductDetail] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime