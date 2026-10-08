"""
Daily Visit Tracker submit endpoint.

See daily_visit_tracker_schemas.py's module docstring for the full
contract and the district/village design decision. This file is the
implementation: resolve the farmer, re-validate trial stock server-side
(the mobile UI already blocks over-stock selection, but that alone isn't
enough - two visits submitted in quick succession could each pass the
client-side check against the same starting stock and together exceed
it, so the same remaining-stock math from trial_router.py's
GET /trial/my-stock runs again here, inside the same transaction as the
write, immediately before it), then insert the visits anchor row plus
every satellite table from migration 202608250001.
"""

from __future__ import annotations

import logging
import uuid
import json
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal
from typing import Annotated, Optional

from app.infrastructure.config.company_time import company_today, company_tz

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.use_cases.farmer_use_case import FarmerUseCase
from app.core.container import get_farmer_use_case
from app.application.services.option_description_service import (
    validate_option_description, validate_multi_option_descriptions,
    option_requires_description, clear_if_not_required,
)
from app.infrastructure.database.session import get_db_session
from app.presentation.api.v1.routers.stock_router import record_movement
from app.domain.services.pricing import RESOLVE_PRICE_SQL
from app.presentation.api.v1.dependencies import CurrentUser
from app.presentation.api.v1.routers.admin_daily_visit_router import _assemble_visit_detail
from app.presentation.schemas.daily_visit_tracker_schemas import (
    DailyVisitTrackerSubmitRequest,
    DailyVisitTrackerSubmitResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/visits/daily-tracker", tags=["daily-visit-tracker"])


async def _resolve_sale_price(
    session: AsyncSession,
    product_id: uuid.UUID,
    quantity: int,
    dealer_id: Optional[uuid.UUID] = None,
) -> Optional[Decimal]:
    """The unit price for this quantity, or None if it cannot be determined.

    Uses the shared band-resolution SQL so a field sale and a dealer order for
    the same product and quantity are priced identically. Returns None rather
    than raising: a visit is a record of something that already happened in a
    field, and refusing to save it because a price could not be worked out
    would lose the visit. The line is stored with a NULL price instead, and
    the dashboard reports it as quantity with value not recorded.
    """
    try:
        row = (
            await session.execute(
                text(RESOLVE_PRICE_SQL).bindparams(
                    product_id=str(product_id),
                    dealer_id=str(dealer_id) if dealer_id else None,
                    quantity=quantity,
                )
            )
        ).scalar_one_or_none()
    except Exception:  # noqa: BLE001 - see docstring: never lose the visit
        logger.exception("field_sale_price_resolution_failed", extra={"product_id": str(product_id)})
        return None
    return Decimal(row) if row is not None else None


@router.post("/submit", response_model=DailyVisitTrackerSubmitResponse, status_code=status.HTTP_201_CREATED)
async def submit_daily_visit(
    payload: DailyVisitTrackerSubmitRequest,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    farmer_use_case: Annotated[FarmerUseCase, Depends(get_farmer_use_case)],
) -> DailyVisitTrackerSubmitResponse:
    # --- Enum-lookup validation (migration 202608260010) ---
    # crop_status/farming_type/demo_status used to be enforced by
    # database CHECK constraints; those were replaced with rows in
    # enum_field_options so Admin can safely add/remove values without a
    # schema migration each time (see that migration's docstring). A
    # live lookup table can't be expressed as a static CHECK constraint,
    # so this application-level check is now the only place these values
    # are actually validated - checked before any write happens, so an
    # invalid value never partially writes anything.
    async def _validate_enum(field_name: str, value: str | None) -> None:
        if value is None:
            return
        row = await session.execute(
            text("SELECT 1 FROM enum_field_options WHERE field_name = :field_name AND value = :value AND is_active = true")
            .bindparams(field_name=field_name, value=value)
        )
        if not row.first():
            raise HTTPException(status_code=422, detail=f"'{value}' is not a valid value for {field_name}.")

    await _validate_enum("crop_status", payload.crop_status)

    # Option-description enforcement (single- and multi-select).
    # Runs before any write so an invalid submission cannot leave a
    # partial visit behind. Which options need a description is read
    # from enum_field_options.requires_description, so admin-created
    # options like "Miscellaneous" are covered without a code change.
    await validate_option_description(
        session, "crop_status", payload.crop_status, payload.status_other_text)
    await validate_multi_option_descriptions(
        session, "pests", [str(p) for p in payload.pest_ids], payload.pest_other_text)
    await validate_multi_option_descriptions(
        session, "diseases", [str(d) for d in payload.disease_ids], payload.disease_other_text)
    await _validate_enum("farming_type", payload.farming_type)
    await _validate_enum("demo_status", payload.demo_status)

    # --- Farmer resolution (section 6 / 36: exactly one path, no dupes) ---
    if bool(payload.farmer_id) == bool(payload.new_farmer):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide exactly one of farmer_id (existing farmer) or new_farmer (new farmer details).",
        )

    if payload.new_farmer:
        try:
            farmer = await farmer_use_case.register_farmer(
                name=payload.new_farmer.name,
                phone=payload.new_farmer.phone,
                village=payload.new_farmer.village,
                taluk=payload.new_farmer.taluk,
                district=payload.new_farmer.district,
                crop=payload.new_farmer.crop,
                cents=payload.new_farmer.cents,
                created_by=current_user.user_id,
            )
        except ValueError as e:
            # register_farmer raises on duplicate phone - surfaced as a
            # normal 409 rather than a 500, since it's an expected,
            # recoverable case (the officer should switch to "Existing
            # Farmer" and search for this number instead).
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
        farmer_id = farmer.id
    else:
        existing = await session.execute(text("SELECT id FROM farmers WHERE id = :id AND is_deleted = false").bindparams(id=payload.farmer_id))
        if not existing.first():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Farmer not found.")
        farmer_id = payload.farmer_id

    # --- Trial stock re-validation (section 22/34) - same query as
    # GET /trial/my-stock, re-run server-side immediately before the
    # write so a race between two near-simultaneous submissions can't
    # jointly exceed real stock even though each individually passed the
    # client-side check against a now-stale "remaining" figure. ---
    if payload.is_trial and payload.trial_products:
        stock_result = await session.execute(
            text(
                """
                SELECT p.id AS product_id, p.name AS product_name,
                       COALESCE(SUM(sl.qty_delta), 0) AS remaining
                FROM products p
                LEFT JOIN stock_ledger sl
                       ON sl.product_id = p.id AND sl.officer_id = :officer_id
                WHERE p.id = ANY(:product_ids)
                GROUP BY p.id, p.name
                """
            ).bindparams(officer_id=current_user.user_id, product_ids=[tp.product_id for tp in payload.trial_products])
        )
        remaining_by_product = {row.product_id: float(row.remaining) for row in stock_result.all()}
        for tp in payload.trial_products:
            remaining = remaining_by_product.get(tp.product_id, 0.0)
            if tp.quantity_given > remaining:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Only {remaining} remaining for one of the selected products - reduce the quantity given.",
                )

    now = datetime.now(timezone.utc)
    visit_id = uuid.uuid4()

    # --- visits anchor row: single-shot (start_time = end_time = now),
    # unlike VisitScreen's separate /visits/start + /visits/end lifecycle,
    # since the Daily Visit Tracker is filled out as one report, not a
    # timed check-in/check-out session. ---
    await session.execute(
        text(
            """
            INSERT INTO visits (
                id, user_id, visit_type, farmer_id, start_time, end_time,
                location_start, location_end, task_completed,
                is_trial, farm_size_value, farm_size_unit, farming_type,
                next_visit_date, follow_up_remarks, officer_remarks, created_at, updated_at
            ) VALUES (
                :id, :user_id, 'farmer', :farmer_id, :now, :now,
                ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
                ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, true,
                :is_trial, :farm_size_value, :farm_size_unit, :farming_type,
                :next_visit_date, :follow_up_remarks, :officer_remarks, :now, :now
            )
            """
        ).bindparams(
            id=visit_id, user_id=current_user.user_id, farmer_id=farmer_id, now=now,
            lat=payload.latitude, lng=payload.longitude,
            is_trial=payload.is_trial, farm_size_value=payload.farm_size_value, farm_size_unit=payload.farm_size_unit,
            farming_type=payload.farming_type, next_visit_date=payload.next_follow_up_date,
            follow_up_remarks=payload.follow_up_remarks, officer_remarks=payload.officer_remarks,
        )
    )

    # --- Step 3: crop profile ---
    await session.execute(
        text(
            """
            INSERT INTO visit_crop_profiles (
                id, visit_id, crop_category_id, crop_category_other_text, crop_id, crop_other_text, variety_id, variety_text,
                crop_age_value, crop_age_unit, sowing_date, previous_crop_text,
                previous_yield_value, previous_yield_unit, recurring_issue_text
            ) VALUES (
                gen_random_uuid(), :visit_id, :crop_category_id, :crop_category_other_text, :crop_id, :crop_other_text, :variety_id, :variety_text,
                :crop_age_value, :crop_age_unit, :sowing_date, :previous_crop_text,
                :previous_yield_value, :previous_yield_unit, :recurring_issue_text
            )
            """
        ).bindparams(
            visit_id=visit_id, crop_category_id=payload.crop_category_id,
            crop_category_other_text=payload.crop_category_other_text, crop_id=payload.crop_id,
            crop_other_text=payload.crop_other_text,
            variety_id=payload.variety_id, variety_text=payload.variety_text,
            crop_age_value=payload.crop_age_value, crop_age_unit=payload.crop_age_unit,
            sowing_date=payload.sowing_date, previous_crop_text=payload.previous_crop_text,
            previous_yield_value=payload.previous_yield_value, previous_yield_unit=payload.previous_yield_unit,
            recurring_issue_text=payload.recurring_issue_text,
        )
    )

    # --- Step 4: nutrients + multi-select join tables + advisory ---
    if payload.npk_n or payload.npk_p or payload.npk_k:
        await session.execute(
            text(
                """
                INSERT INTO visit_nutrients (id, visit_id, n_qty, p_qty, k_qty, npk_unit, frequency)
                VALUES (gen_random_uuid(), :visit_id, :n, :p, :k, :unit, :freq)
                """
            ).bindparams(visit_id=visit_id, n=payload.npk_n, p=payload.npk_p, k=payload.npk_k, unit=payload.npk_unit, freq=payload.npk_frequency)
        )

    for m in payload.micronutrients:
        await session.execute(
            text(
                """
                INSERT INTO visit_micronutrients (id, visit_id, micronutrient_id, quantity, unit, other_text)
                VALUES (gen_random_uuid(), :visit_id, :mid, :qty, :unit, :other_text)
                """
            ).bindparams(visit_id=visit_id, mid=m.micronutrient_id, qty=m.quantity, unit=m.unit, other_text=m.other_text)
        )

    for op_ in payload.farm_operations:
        await session.execute(
            text(
                """
                INSERT INTO visit_farm_operations (id, visit_id, farm_operation_id, performed_date, remarks, other_text)
                VALUES (gen_random_uuid(), :visit_id, :opid, :date, :remarks, :other_text)
                """
            ).bindparams(visit_id=visit_id, opid=op_.farm_operation_id, date=op_.performed_date, remarks=op_.remarks, other_text=op_.other_text)
        )

    for sol in payload.organic_solutions:
        await session.execute(
            text(
                """
                INSERT INTO visit_organic_solutions (id, visit_id, organic_solution_id, quantity, unit, application_date, remarks, other_text)
                VALUES (gen_random_uuid(), :visit_id, :solid, :qty, :unit, :date, :remarks, :other_text)
                """
            ).bindparams(visit_id=visit_id, solid=sol.organic_solution_id, qty=sol.quantity, unit=sol.unit, date=sol.application_date, remarks=sol.remarks, other_text=sol.other_text)
        )

    await session.execute(
        text(
            """
            INSERT INTO visit_advisory (id, visit_id, used_advisory, source, remarks, ipm_other_text)
            VALUES (gen_random_uuid(), :visit_id, :used, :source, :remarks, :ipm_other_text)
            """
        ).bindparams(
            visit_id=visit_id, used=payload.used_advisory, source=payload.advisory_source, remarks=payload.advisory_remarks,
            ipm_other_text=next((i.other_text for i in payload.ipm_solutions if i.other_text), None),
        )
    )

    # --- IPM/bio solutions - own table, distinct from organic_solutions
    # (see 202608260006 migration docstring for why they can't share one) ---
    for ipm in payload.ipm_solutions:
        await session.execute(
            text("INSERT INTO visit_ipm_solutions (id, visit_id, ipm_solution_id) VALUES (gen_random_uuid(), :visit_id, :ipm_id)")
            .bindparams(visit_id=visit_id, ipm_id=ipm.ipm_solution_id)
        )

    # --- Step 5: health & diagnosis ---
    await session.execute(
        text(
            """
            INSERT INTO visit_health (id, visit_id, crop_status, severity, status_other_text, pest_other_text, disease_other_text)
            VALUES (gen_random_uuid(), :visit_id, :status, :severity, :status_other_text, :pest_other_text, :disease_other_text)
            """
        ).bindparams(
            visit_id=visit_id, status=payload.crop_status, severity=payload.severity,
            status_other_text=clear_if_not_required(
                await option_requires_description(session, "crop_status", payload.crop_status),
                payload.status_other_text),
            pest_other_text=payload.pest_other_text,
            disease_other_text=payload.disease_other_text,
        )
    )
    for pest_id in payload.pest_ids:
        await session.execute(
            text("INSERT INTO visit_health_pests (id, visit_id, pest_id) VALUES (gen_random_uuid(), :visit_id, :pid)")
            .bindparams(visit_id=visit_id, pid=pest_id)
        )
    for disease_id in payload.disease_ids:
        await session.execute(
            text("INSERT INTO visit_health_diseases (id, visit_id, disease_id) VALUES (gen_random_uuid(), :visit_id, :did)")
            .bindparams(visit_id=visit_id, did=disease_id)
        )
    for chem in payload.chemicals:
        await session.execute(
            text(
                """
                INSERT INTO visit_health_chemicals (id, visit_id, chemical_id, chemical_name_text, quantity, frequency)
                VALUES (gen_random_uuid(), :visit_id, :cid, :cname, :qty, :freq)
                """
            ).bindparams(visit_id=visit_id, cid=chem.chemical_id, cname=chem.chemical_name_text, qty=chem.quantity, freq=chem.frequency)
        )

    # --- Step 6: trial/demo details - always inserted, not gated by
    # is_trial. Purpose and demo_status are required for every visit now
    # (demo_status's own 'not_discussed' value only makes sense on a
    # non-trial visit), whereas trial_products genuinely only applies
    # when a trial is actually running - that part stays is_trial-gated. ---
    await session.execute(
        text(
            """
            INSERT INTO visit_trial_details (id, visit_id, visit_purpose, demo_status, trial_plot_size_cents, farmers_present_count)
            VALUES (gen_random_uuid(), :visit_id, :purpose, :status, :plot_size, :farmers_present)
            """
        ).bindparams(
            visit_id=visit_id, purpose=payload.visit_purpose, status=payload.demo_status,
            plot_size=payload.trial_plot_size_cents, farmers_present=payload.farmers_present_count,
        )
    )
    if payload.is_trial:
        for tp in payload.trial_products:
            await session.execute(
                text(
                    """
                    INSERT INTO visit_trial_products (id, visit_id, product_id, quantity_given, quantity_leftover, created_at)
                    VALUES (gen_random_uuid(), :visit_id, :pid, :qty, :qty, :now)
                    """
                ).bindparams(visit_id=visit_id, pid=tp.product_id, qty=tp.quantity_given, now=now)
            )

            # THE AUTOMATIC DEDUCTION.
            #
            # Same loop, same transaction as the visit_trial_products
            # insert above - deliberately. Previously a trial reduced one
            # screen's derived figure and left the officer's editable
            # current_quantity untouched, so the two stock screens
            # disagreed from the first trial onwards.
            #
            # Written as a ledger row rather than an UPDATE to a balance,
            # because there is no balance to update: stock is
            # SUM(qty_delta), so appending this row IS the deduction. And
            # because it shares the visit's transaction, there is no code
            # path where a trial is recorded without its stock movement -
            # if either fails, both roll back.
            await record_movement(
                session,
                officer_id=current_user.user_id,
                product_id=tp.product_id,
                quantity=tp.quantity_given,
                movement_type="trial_given",
                created_by=current_user.user_id,
                ref_type="visit",
                ref_id=visit_id,
                remarks="Trial given during visit",
            )

    # --- Step 7: sales ---
    await session.execute(
        text(
            """
            INSERT INTO visit_sales (id, visit_id, purchased, order_value, conversion_status)
            VALUES (gen_random_uuid(), :visit_id, :purchased, :order_value, :conversion_status)
            """
        ).bindparams(visit_id=visit_id, purchased=payload.purchased, order_value=payload.order_value, conversion_status=payload.conversion_status)
    )
    # Each sale line is valued as it is written. Until migration 202609300002
    # these rows carried quantity and no price, so a field sale contributed
    # units to the reports and no money - the field force, which is what this
    # application exists to manage, was invisible in every revenue figure.
    #
    # The price comes from the same quantity bands a dealer order is priced
    # from, at the general (all-dealers) rate: this tracker records a visit to
    # a FARMER, so no dealer-specific band applies. It is STORED, not
    # recomputed on read, because what was charged is a fact about the day it
    # happened; recomputing later would restate last quarter's revenue every
    # time somebody edits a price band.
    #
    # A price that cannot be resolved leaves both columns NULL rather than
    # writing a zero. The dashboard then counts the line as quantity and says
    # its value is not recorded, which is true; a zero would read as a sale
    # that earned nothing.
    for item in payload.sale_items:
        unit_price = None
        line_total = None
        try:
            quantity = int(item.quantity)
        except (TypeError, ValueError):
            quantity = 0
        if quantity >= 1:
            resolved = await _resolve_sale_price(
                session, product_id=item.product_id, quantity=quantity
            )
            if resolved is not None:
                unit_price = resolved
                line_total = resolved * Decimal(quantity)

        await session.execute(
            text(
                """
                INSERT INTO visit_sale_items
                    (id, visit_id, product_id, quantity, unit, unit_price, line_total)
                VALUES
                    (gen_random_uuid(), :visit_id, :pid, :qty, :unit, :unit_price, :line_total)
                """
            ).bindparams(
                visit_id=visit_id,
                pid=item.product_id,
                qty=item.quantity,
                unit=item.unit,
                unit_price=unit_price,
                line_total=line_total,
            )
        )

    # --- Step 8: photos ---
    for url in payload.photo_urls:
        await session.execute(
            text(
                """
                INSERT INTO visit_photos (id, visit_id, photo_url, photo_type, uploaded_by, created_at)
                VALUES (gen_random_uuid(), :visit_id, :url, 'crop_condition', :officer_id, :now)
                """
            ).bindparams(visit_id=visit_id, url=url, officer_id=current_user.user_id, now=now)
        )

    # --- Delete the source draft, if any, in the same transaction as the
    # visit creation above - ownership-checked so a draft_id can't be
    # used to delete another officer's draft. ---
    if payload.draft_id:
        await session.execute(
            text("DELETE FROM visit_drafts WHERE id = :draft_id AND officer_id = :officer_id")
            .bindparams(draft_id=payload.draft_id, officer_id=current_user.user_id)
        )

    # --- Custom Fields (transactional save) ---
    from app.application.services.custom_field_service import validate_and_save_custom_answers
    await validate_and_save_custom_answers(
        session=session,
        form_key="day_closure",
        record_id=visit_id,
        answers=payload.custom_field_answers,
        client_version=payload.config_version,
        user_id=current_user.user_id,
        role=current_user.role,
    )

    await session.commit()

    return DailyVisitTrackerSubmitResponse(visit_id=visit_id, farmer_id=farmer_id, created_at=now)


# --- Section 28: officer's own "My Visits" history. Distinct from the
# admin list endpoint in admin_daily_visit_router.py - always scoped to
# the calling officer, no admin/manager gate, and no filter panel (this
# is "what have I submitted," not a reporting tool). Detail reuses the
# exact same _assemble_visit_detail() the admin side uses - one
# assembly function, two authorization paths, not two implementations
# that could drift apart.

class MyVisitListItem(BaseModel):
    visit_id: uuid.UUID
    visit_date: date
    farmer_name: Optional[str] = None
    village: Optional[str] = None
    crop_name: Optional[str] = None
    is_trial: bool
    demo_status: Optional[str] = None
    purchased: Optional[bool] = None
    conversion_status: Optional[str] = None


@router.get("/my-visits", response_model=list[MyVisitListItem])
async def list_my_visits(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    limit: int = 50,
    offset: int = 0,
) -> list[MyVisitListItem]:
    result = await session.execute(
        text(
            """
            SELECT
                v.id AS visit_id, v.start_time::date AS visit_date,
                f.name AS farmer_name, f.village,
                c.name AS crop_name, v.is_trial, vtd.demo_status,
                vs.purchased, vs.conversion_status
            FROM visits v
            LEFT JOIN farmers f ON f.id = v.farmer_id
            LEFT JOIN visit_crop_profiles vcp ON vcp.visit_id = v.id
            LEFT JOIN crops c ON c.id = vcp.crop_id
            LEFT JOIN visit_trial_details vtd ON vtd.visit_id = v.id
            LEFT JOIN visit_sales vs ON vs.visit_id = v.id
            WHERE v.user_id = :officer_id
            ORDER BY v.start_time DESC
            LIMIT :limit OFFSET :offset
            """
        ).bindparams(officer_id=current_user.user_id, limit=limit, offset=offset)
    )
    return [
        MyVisitListItem(
            visit_id=row.visit_id, visit_date=row.visit_date, farmer_name=row.farmer_name,
            village=row.village, crop_name=row.crop_name, is_trial=row.is_trial,
            demo_status=row.demo_status, purchased=row.purchased, conversion_status=row.conversion_status,
        )
        for row in result.all()
    ]


# --- Section 26/27: Save Draft / Resume Draft. Registered before
# GET /{visit_id} below since "/drafts" is the same single-segment shape
# FastAPI would otherwise try to match against {visit_id} first (same
# ordering concern as /my-visits above). draft_data is stored and
# returned as an opaque JSON blob - the mobile wizard's own in-progress
# state shape, not validated against DailyVisitTrackerSubmitRequest
# (which a genuine partial draft usually can't satisfy - required fields
# aren't filled in yet by definition). ---

class DraftSummary(BaseModel):
    id: uuid.UUID
    updated_at: datetime
    farmer_name: Optional[str] = None
    crop_name: Optional[str] = None
    step_label: Optional[str] = None


class DraftSaveRequest(BaseModel):
    draft_id: Optional[uuid.UUID] = None  # None = create a new draft; set = update that one
    draft_data: dict


class DraftSaveResponse(BaseModel):
    draft_id: uuid.UUID
    updated_at: datetime


# --- Section 39: Field Officer dashboard summary cards. One aggregate
# query per group (Today's Visits / Trial / Sales), all real counts off
# the tables this feature already writes to - draft_count reuses the
# same visit_drafts table the /drafts endpoints below manage, nothing
# duplicated. Time windows are deliberately spelled out here rather than
# left ambiguous: "today" for visits, "this calendar month" for trials
# started, all-time totals for drafts/submitted/converted/orders/value -
# picked as the most useful default for each, not a guess left unstated.
class DashboardSummary(BaseModel):
    visits_today: int
    draft_count: int
    submitted_total: int
    trial_active: int
    trial_started_this_month: int
    trial_converted_total: int
    sales_orders_total: int
    sales_conversions_total: int
    sales_order_value_total: float


@router.get("/dashboard-summary", response_model=DashboardSummary)
async def get_dashboard_summary(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> DashboardSummary:
    officer_id = current_user.user_id

    visits_today = (
        await session.execute(
            text("SELECT COUNT(*) FROM visits WHERE user_id = :officer_id AND start_time >= :day_start AND start_time < :day_end")
            .bindparams(officer_id=officer_id, day_start=datetime.combine(company_today(), datetime.min.time(), tzinfo=company_tz()), day_end=datetime.combine(company_today(), datetime.min.time(), tzinfo=company_tz()) + timedelta(days=1))
        )
    ).scalar() or 0

    draft_count = (
        await session.execute(text("SELECT COUNT(*) FROM visit_drafts WHERE officer_id = :officer_id").bindparams(officer_id=officer_id))
    ).scalar() or 0

    submitted_total = (
        await session.execute(text("SELECT COUNT(*) FROM visits WHERE user_id = :officer_id").bindparams(officer_id=officer_id))
    ).scalar() or 0

    trial_active = (
        await session.execute(
            text(
                """
                SELECT COUNT(*) FROM visits v JOIN visit_trial_details vtd ON vtd.visit_id = v.id
                WHERE v.user_id = :officer_id AND v.is_trial = true
                AND (vtd.demo_status IS NULL OR vtd.demo_status IN ('agreed', 'started_today', 'running'))
                """
            ).bindparams(officer_id=officer_id)
        )
    ).scalar() or 0

    today = company_today()
    month_start = datetime(today.year, today.month, 1, tzinfo=company_tz())
    next_month = today.month % 12 + 1
    next_month_year = today.year + (today.month // 12)
    next_month_start = datetime(next_month_year, next_month, 1, tzinfo=company_tz())

    trial_started_this_month = (
        await session.execute(
            text(
                "SELECT COUNT(*) FROM visits WHERE user_id = :officer_id AND is_trial = true "
                "AND start_time >= :month_start AND start_time < :next_month_start"
            ).bindparams(officer_id=officer_id, month_start=month_start, next_month_start=next_month_start)
        )
    ).scalar() or 0

    trial_converted_total = (
        await session.execute(
            text(
                """
                SELECT COUNT(*) FROM visits v JOIN visit_trial_details vtd ON vtd.visit_id = v.id
                WHERE v.user_id = :officer_id AND vtd.demo_status = 'converted'
                """
            ).bindparams(officer_id=officer_id)
        )
    ).scalar() or 0

    sales_row = (
        await session.execute(
            text(
                """
                SELECT
                    COUNT(*) FILTER (WHERE vs.purchased = true) AS orders,
                    COUNT(*) FILTER (WHERE vs.conversion_status = 'converted') AS conversions,
                    COALESCE(SUM(vs.order_value) FILTER (WHERE vs.purchased = true), 0) AS total_value
                FROM visits v JOIN visit_sales vs ON vs.visit_id = v.id
                WHERE v.user_id = :officer_id
                """
            ).bindparams(officer_id=officer_id)
        )
    ).first()

    return DashboardSummary(
        visits_today=visits_today,
        draft_count=draft_count,
        submitted_total=submitted_total,
        trial_active=trial_active,
        trial_started_this_month=trial_started_this_month,
        trial_converted_total=trial_converted_total,
        sales_orders_total=sales_row.orders if sales_row else 0,
        sales_conversions_total=sales_row.conversions if sales_row else 0,
        sales_order_value_total=float(sales_row.total_value) if sales_row else 0.0,
    )


@router.get("/drafts", response_model=list[DraftSummary])
async def list_my_drafts(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[DraftSummary]:
    result = await session.execute(
        text("SELECT id, draft_data, updated_at FROM visit_drafts WHERE officer_id = :officer_id ORDER BY updated_at DESC")
        .bindparams(officer_id=current_user.user_id)
    )
    summaries = []
    for row in result.all():
        d = row.draft_data or {}
        # Best-effort display fields pulled straight out of the JSON blob
        # - whatever the officer had typed in Steps 2/3 by the time they
        # saved, purely for telling drafts apart in a list. Never used
        # for anything structural.
        summaries.append(
            DraftSummary(
                id=row.id,
                updated_at=row.updated_at,
                farmer_name=d.get("_farmer_name") or (d.get("new_farmer") or {}).get("name"),
                crop_name=d.get("_crop_name"),
                step_label=d.get("_step_label"),
            )
        )
    return summaries


@router.get("/drafts/{draft_id}")
async def get_my_draft(
    draft_id: uuid.UUID,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    result = await session.execute(
        text("SELECT draft_data FROM visit_drafts WHERE id = :id AND officer_id = :officer_id")
        .bindparams(id=draft_id, officer_id=current_user.user_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found.")
    return row.draft_data or {}


@router.post("/drafts", response_model=DraftSaveResponse)
async def save_my_draft(
    payload: DraftSaveRequest,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> DraftSaveResponse:
    now = datetime.now(timezone.utc)
    if payload.draft_id:
        # Update only if it's actually this officer's draft - ownership
        # check happens as part of the WHERE clause itself (an UPDATE
        # matching zero rows just means "not found/not yours").
        result = await session.execute(
            text(
                "UPDATE visit_drafts SET draft_data = CAST(:data AS JSONB), updated_at = :now "
                "WHERE id = :id AND officer_id = :officer_id RETURNING id, updated_at"
            ).bindparams(data=json.dumps(payload.draft_data), now=now, id=payload.draft_id, officer_id=current_user.user_id)
        )
        row = result.first()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found.")
        await session.commit()
        return DraftSaveResponse(draft_id=row.id, updated_at=row.updated_at)

    new_id = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO visit_drafts (id, officer_id, draft_data, created_at, updated_at) "
            "VALUES (:id, :officer_id, CAST(:data AS JSONB), :now, :now)"
        ).bindparams(id=new_id, officer_id=current_user.user_id, data=json.dumps(payload.draft_data), now=now)
    )
    await session.commit()
    return DraftSaveResponse(draft_id=new_id, updated_at=now)


@router.delete("/drafts/{draft_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_my_draft(
    draft_id: uuid.UUID,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    existing = await session.execute(
        text("SELECT id FROM visit_drafts WHERE id = :id AND officer_id = :officer_id")
        .bindparams(id=draft_id, officer_id=current_user.user_id)
    )
    if not existing.first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found.")
    await session.execute(text("DELETE FROM visit_drafts WHERE id = :id").bindparams(id=draft_id))
    await session.commit()


@router.get("/{visit_id}")
async def get_my_visit_detail(
    visit_id: uuid.UUID,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    # Ownership check first, before assembling anything - an officer can
    # view their own submitted visits (section 28) but not anyone else's;
    # admin/manager already have their own detail route with its own
    # role gate in admin_daily_visit_router.py, so this stays officer-only
    # rather than trying to also serve the admin case through one route.
    owner_check = await session.execute(text("SELECT user_id FROM visits WHERE id = :id").bindparams(id=visit_id))
    owner_row = owner_check.first()
    if not owner_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Visit not found.")
    if owner_row.user_id != current_user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to view this visit.")

    detail = await _assemble_visit_detail(visit_id, session)
    if detail is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Visit not found.")
    return detail

