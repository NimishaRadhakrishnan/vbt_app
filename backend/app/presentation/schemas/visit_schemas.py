"""
Field Visit Pydantic schemas.
"""

from __future__ import annotations
from typing import Optional

import uuid
from datetime import date, datetime
from pydantic import BaseModel, Field


class TrialProductEntry(BaseModel):
    product_id: uuid.UUID
    quantity_given: float = Field(gt=0)


class TrialLeftoverEntry(BaseModel):
    product_id: uuid.UUID
    quantity_leftover: float = Field(ge=0)


class TrialProductResponse(BaseModel):
    product_id: uuid.UUID
    product_name: str
    quantity_given: float
    quantity_leftover: float


class StartVisitRequest(BaseModel):
    visit_type: str = Field(pattern="^(farmer|dealer)$")
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)
    farmer_id: Optional[uuid.UUID] = None
    dealer_id: Optional[uuid.UUID] = None
    photo_url_farmer: Optional[str] = None
    photo_url_farm: Optional[str] = None
    crop: Optional[str] = None
    purpose: Optional[str] = None
    products_demonstrated: list[str] = Field(default_factory=list)
    # Trial field (section 4). trial_products is required to be non-empty
    # when is_trial=True (checked in the router, not here, since it needs
    # a cross-field check) and must be empty/omitted when is_trial=False -
    # no validation is run on it in that case, per the spec.
    is_trial: bool = False
    trial_products: list[TrialProductEntry] = Field(default_factory=list)


class EndVisitRequest(BaseModel):
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)
    task_completed: bool = Field(default=True)
    next_visit_date: Optional[date] = None
    voice_notes_url: Optional[str] = None
    voice_notes_transcript_ta: Optional[str] = None
    voice_notes_transcript_en: Optional[str] = None
    # Trial leftovers (section 4, decision 5: quantity_given is locked in
    # at visit start, quantity_leftover stays editable through end-of-visit).
    trial_leftovers: list[TrialLeftoverEntry] = Field(default_factory=list)
    # Structured KPI rollup (section 5) - replaces the free-text daily
    # report as the primary productivity record for this visit.
    farmers_covered: Optional[int] = Field(default=None, ge=0)
    demos_conducted: Optional[int] = Field(default=None, ge=0)
    villages_covered: Optional[list[str]] = None
    cents_covered: Optional[float] = Field(default=None, ge=0)
    conversions: Optional[int] = Field(default=None, ge=0)


class VisitResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    visit_type: str
    start_time: datetime
    location_start_lat: float
    location_start_lng: float
    farmer_id: Optional[uuid.UUID] = None
    dealer_id: Optional[uuid.UUID] = None
    end_time: Optional[datetime] = None
    duration_seconds: Optional[int] = None
    location_end_lat: Optional[float] = None
    location_end_lng: Optional[float] = None
    photo_url_farmer: Optional[str] = None
    photo_url_farm: Optional[str] = None
    crop: Optional[str] = None
    purpose: Optional[str] = None
    products_demonstrated: list[str]
    task_completed: bool
    next_visit_date: Optional[date] = None
    voice_notes_url: Optional[str] = None
    voice_notes_transcript_ta: Optional[str] = None
    voice_notes_transcript_en: Optional[str] = None
    created_at: datetime
    is_trial: bool = False
    trial_products: list[TrialProductResponse] = Field(default_factory=list)
    farmers_covered: int = 0
    demos_conducted: int = 0
    villages_covered: list[str] = Field(default_factory=list)
    cents_covered: Optional[float] = None
    conversions: int = 0