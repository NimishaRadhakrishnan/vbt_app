"""
Daily Visit Tracker submit contract.

This is a NEW endpoint (POST /visits/daily-tracker/submit), not an
extension of the existing /visits/start + /visits/end lifecycle -
VisitScreen's quick GPS check-in/out stays exactly as it is. The Daily
Visit Tracker is a single-shot structured submission: everything
collected across the mobile wizard's 8 data-entry steps arrives in one
request and is written in one transaction, creating the `visits` anchor
row directly (start_time = end_time = submission time, task_completed =
true) plus a satellite row in each detail table from migration
202608250001.

DESIGN DECISION worth being explicit about: Step 1 of the wizard collects
district/village-block, but the `visits` table has no district/village
columns of its own (deliberately, from the original schema - visits
already relate to farmers/dealers, who carry their own district/village).
Rather than add duplicate location columns to `visits`, those Step 1
answers exist to support Step 2: for a NEW farmer, they seed the new
farmer record's district/village; for an EXISTING farmer, they're
discarded in favor of that farmer's real district/village once selected.
This keeps district/village as a farmer-level fact, not a farmer-and-
visit-level fact stored twice - straightforwardly the "no duplicate
records" instruction from section 36 applied to this specific field.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal, Optional, Any

from pydantic import BaseModel, Field

# Kept in step with ck_visit_trial_purpose on visit_trial_details. If the
# migration's allowed set changes, change it here in the same commit.
VisitPurpose = Literal["new_contact", "demo_setup", "routine_follow_up", "field_day"]


# --- Step 2: farmer (existing OR new - contract enforces exactly one) ---
class NewFarmerInput(BaseModel):
    name: str
    phone: str
    village: str
    taluk: str
    district: str
    crop: str
    cents: float


# --- Step 4: farm practices & inputs ---
class MicronutrientInput(BaseModel):
    micronutrient_id: uuid.UUID
    quantity: Optional[float] = None
    unit: Optional[str] = None
    other_text: Optional[str] = None  # set when micronutrient_id points at the "Other" catalog row


class FarmOperationInput(BaseModel):
    farm_operation_id: uuid.UUID
    performed_date: Optional[date] = None
    remarks: Optional[str] = None
    other_text: Optional[str] = None  # set when farm_operation_id points at the "Other" catalog row


class OrganicSolutionInput(BaseModel):
    organic_solution_id: uuid.UUID
    quantity: Optional[float] = None
    unit: Optional[str] = None
    application_date: Optional[date] = None
    remarks: Optional[str] = None
    other_text: Optional[str] = None  # set when organic_solution_id points at the "Other" catalog row


class IpmSolutionInput(BaseModel):
    ipm_solution_id: uuid.UUID
    other_text: Optional[str] = None  # set when ipm_solution_id points at the "Other" catalog row


# --- Step 5: crop health & diagnosis ---
class ChemicalInput(BaseModel):
    chemical_id: Optional[uuid.UUID] = None
    chemical_name_text: Optional[str] = None  # fallback if not yet in master data
    quantity: Optional[str] = None
    frequency: Optional[str] = None


# --- Step 6: trial/demo (reuses the existing TrialProductEntry shape from
# visit_schemas.py conceptually - a separate type here since this
# endpoint's request body is independent of /visits/start's) ---
class TrialProductInput(BaseModel):
    product_id: uuid.UUID
    quantity_given: float = Field(gt=0)


# --- Step 7: sales conversion ---
class SaleItemInput(BaseModel):
    product_id: uuid.UUID
    quantity: float = Field(gt=0)
    unit: Optional[str] = None


class DailyVisitTrackerSubmitRequest(BaseModel):
    # If this submission started from a saved draft, deleting that draft
    # row happens in the same transaction as creating the visit (section
    # 26: "do not create duplicate visits when a draft is resumed" - the
    # draft's job ends the moment its data becomes a real visit).
    draft_id: Optional[uuid.UUID] = None

    # --- Step 1: Visit Details ---
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)

    # --- Step 2: Farmer & Farm --- exactly one of farmer_id / new_farmer
    farmer_id: Optional[uuid.UUID] = None
    new_farmer: Optional[NewFarmerInput] = None
    farm_size_value: float = Field(gt=0)
    farm_size_unit: str = "cents"

    # --- Step 3: Crop Profile ---
    crop_category_id: Optional[uuid.UUID] = None
    crop_category_other_text: Optional[str] = None
    crop_id: Optional[uuid.UUID] = None
    crop_other_text: Optional[str] = None  # typed crop name when the officer picks "Other"
    variety_id: Optional[uuid.UUID] = None
    variety_text: Optional[str] = None
    crop_age_value: Optional[float] = None
    crop_age_unit: Optional[str] = None  # days | weeks | months | years
    sowing_date: Optional[date] = None
    previous_crop_text: Optional[str] = None
    previous_yield_value: Optional[float] = None
    previous_yield_unit: Optional[str] = None
    recurring_issue_text: Optional[str] = None  # recurring pest/disease issue from past seasons
    farming_type: str  # certified_organic | natural_farming | transitioning | conventional

    # --- Step 4: Farm Practices & Inputs ---
    npk_n: Optional[float] = None
    npk_p: Optional[float] = None
    npk_k: Optional[float] = None
    npk_unit: Optional[str] = None
    npk_frequency: Optional[str] = None
    micronutrients: list[MicronutrientInput] = Field(default_factory=list)
    farm_operations: list[FarmOperationInput] = Field(default_factory=list)
    organic_solutions: list[OrganicSolutionInput] = Field(default_factory=list)
    used_advisory: bool = False
    advisory_source: Optional[str] = None  # agri_clinic | kvk | other
    advisory_remarks: Optional[str] = None
    used_ipm: bool = False
    ipm_solutions: list[IpmSolutionInput] = Field(default_factory=list)

    # --- Step 5: Crop Health & Diagnosis ---
    crop_status: str  # healthy | mild_stress | pest_disease_affected | drought | waterlogged | nutrient_deficiency | other
    status_other_text: Optional[str] = None
    pest_ids: list[uuid.UUID] = Field(default_factory=list)
    pest_other_text: Optional[str] = None
    disease_ids: list[uuid.UUID] = Field(default_factory=list)
    disease_other_text: Optional[str] = None
    chemicals: list[ChemicalInput] = Field(default_factory=list)
    severity: Optional[int] = Field(default=None, ge=1, le=10)

    # --- Step 6: Trial / Demo ---
    is_trial: bool = False
    # Mirrors ck_visit_trial_purpose on visit_trial_details. Without this the
    # database rejected an unknown value with CheckViolation, which surfaced
    # as a 500 and told the officer nothing. Validating here returns a 422
    # that names the field and the allowed values.
    visit_purpose: Optional[VisitPurpose] = None
    demo_status: Optional[str] = None  # 8-stage set - see 202608260006 migration
    # ck_visit_trial_plot_size_positive requires > 0, not >= 0.
    trial_plot_size_cents: Optional[float] = Field(default=None, gt=0)
    trial_products: list[TrialProductInput] = Field(default_factory=list)
    farmers_present_count: Optional[int] = Field(default=None, ge=0)

    # --- Step 7: Sales Conversion ---
    purchased: bool = False
    sale_items: list[SaleItemInput] = Field(default_factory=list)
    order_value: Optional[float] = Field(default=None, ge=0)
    conversion_status: Optional[str] = None  # interested | order_placed | converted

    # --- Step 8: Photos & Remarks ---
    photo_urls: list[str] = Field(default_factory=list)
    officer_remarks: Optional[str] = None
    next_follow_up_date: Optional[date] = None
    follow_up_remarks: Optional[str] = None
    
    config_version: int = 1
    custom_field_answers: dict[str, Any] = Field(default_factory=dict)


class DailyVisitTrackerSubmitResponse(BaseModel):
    visit_id: uuid.UUID
    farmer_id: uuid.UUID
    created_at: datetime
