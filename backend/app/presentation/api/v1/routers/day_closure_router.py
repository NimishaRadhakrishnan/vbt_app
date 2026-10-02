"""
Day Closure router.

Field/sales officers must submit today's closure before logging out.
Per direct request, this is now the full Daily Visit Tracker form (crop
profile, health/diagnosis, demo/trial, sales conversion, photos, etc.)
rather than a short summary or a photo upload - both earlier versions of
this feature. Rather than re-implement that ~40-field, 15-satellite-table
model a second time under day_closures, this reuses
daily_visit_tracker_router.submit_daily_visit() directly (the exact same
function, called as a plain Python coroutine with already-resolved
dependencies - Depends() markers only matter to FastAPI's own request
handling, not to a direct call from here) to create a real `visits` row,
then records a day_closures marker (officer_id, date, visit_id) pointing
at it. One data model, one place it can drift, two entry points into it.

The frontend calls GET /status on logout; if closed_today is false, it
blocks logout and prompts the full form via POST /visits/daily-tracker/
submit followed by POST /day-closure/link (see below) - or, for a client
that wants one call, POST /day-closure accepts the same
DailyVisitTrackerSubmitRequest body directly and does both steps
server-side. This router only tracks the submission — it doesn't enforce
logout itself, since logout is a client-side/token action with no
server-side hook to intercept.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.use_cases.farmer_use_case import FarmerUseCase
from app.core.container import get_farmer_use_case
from app.infrastructure.audit.audit_log import write_audit_log
from app.application.services.emergency_override_service import active_override_for
from app.application.services.option_description_service import (
    validate_option_description, option_requires_description, clear_if_not_required,
)
from app.infrastructure.config.company_time import (
    company_today, company_now, is_weekly_working_day, warning_threshold_passed,
)
from app.infrastructure.database.session import get_db_session
from app.infrastructure.storage.local_file_storage import save_upload
from app.application.dto.auth_dto import CurrentUserOutput
from app.presentation.api.v1.dependencies import CurrentUser, require_role
from app.domain.value_objects.role import Role
from app.presentation.api.v1.routers.admin_daily_visit_router import _assemble_visit_detail
from app.presentation.api.v1.routers.daily_visit_tracker_router import submit_daily_visit
from app.presentation.schemas.daily_visit_tracker_schemas import DailyVisitTrackerSubmitRequest
from app.presentation.schemas.day_closure_schemas import (
    DayClosureStatusResponse,
    DayClosureAdminResponse,
    MissingClosureOfficer,
    SalesClosureSubmitRequest,
    SalesClosureResponse,
)

router = APIRouter(prefix="/day-closure", tags=["day-closure"])


@router.post("/upload")
async def upload_closure_document(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    file: UploadFile = File(...),
) -> dict:
    url = await save_upload(file, current_user.user_id, session)
    return {"url": url}


@router.get("/status", response_model=DayClosureStatusResponse)
async def get_today_closure_status(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> DayClosureStatusResponse:
    """Whether this officer has closed today - for EITHER closure type.

    The base query intentionally does not filter on closure_type: any
    row in day_closures for (officer, today) means the day is closed,
    which is what the logout gate needs. Verified against a live
    database - a sales closure correctly returns closed_today=true.

    What this DOES branch on is the descriptive fields. A sales closure
    has no farmer/crop (visit_id is null), so those joins yield nulls
    and the officer previously saw an empty confirmation. Sales closures
    now return dealer/district instead, so the UI has something real
    to show either way.
    """
    result = await session.execute(
        text("""
            SELECT dc.id, dc.visit_id, dc.closure_type,
                   f.name AS farmer_name, f.village,
                   scd.dealer_name, scd.district, scd.visit_purpose
            FROM day_closures dc
            LEFT JOIN visits v ON v.id = dc.visit_id
            LEFT JOIN farmers f ON f.id = v.farmer_id
            LEFT JOIN sales_closure_details scd ON scd.closure_id = dc.id
            WHERE dc.officer_id = :officer_id AND dc.date = :today
              AND dc.is_deleted = false
        """).bindparams(officer_id=current_user.user_id, today=company_today())
    )
    row = result.first()
    if not row:
        return DayClosureStatusResponse(closed_today=False)

    if row.closure_type == "sales_activity":
        return DayClosureStatusResponse(
            closed_today=True,
            closure_id=row.id,
            closure_type="sales_activity",
            # Reuses the existing response fields rather than adding
            # sales-only ones: farmer_name/village are simply "who and
            # where" for a field visit, and dealer/district are the
            # same for a sales visit.
            farmer_name=row.dealer_name,
            village=row.district,
        )

    crop_name = None
    if row.visit_id:
        crop_row = await session.execute(
            text("""
                SELECT c.name AS crop_name FROM visit_crop_profiles vcp
                LEFT JOIN crops c ON c.id = vcp.crop_id
                WHERE vcp.visit_id = :visit_id
            """).bindparams(visit_id=row.visit_id)
        )
        crop = crop_row.first()
        crop_name = crop.crop_name if crop else None

    return DayClosureStatusResponse(
        closed_today=True,
        closure_id=row.id,
        visit_id=row.visit_id,
        farmer_name=row.farmer_name,
        village=row.village,
        crop_name=crop_name,
    )


@router.post("/no-activity", status_code=status.HTTP_201_CREATED)
async def submit_no_activity_closure(
    payload: dict,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    """Close the day with no visits or sales to report (sick, travelling,
    training). Approved requirement - without it an officer with nothing
    to report could never satisfy the 17:30 warning.

    Counts as Submitted: it writes a normal day_closures row, so the
    warning endpoint, missing-today report and (later) the logout gate
    all see it without any of them needing to special-case it.

    A reason is required. The database enforces this too
    (ck_day_closures_no_activity_reason) so the rule holds no matter
    which endpoint writes the row - this check exists to return a clear
    message rather than a raw constraint violation.
    """
    if current_user.role not in ("field_officer", "sales_officer"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Day closure applies to Field and Sales Officers.",
        )

    reason = (payload.get("reason") or "").strip()
    if not reason:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please give a short reason for having no activity today.",
        )

    today = company_today()
    existing = await session.execute(
        text("SELECT id, closure_type, no_activity_reason FROM day_closures WHERE officer_id = :oid AND date = :d")
        .bindparams(oid=current_user.user_id, d=today)
    )
    prior = existing.first()
    if prior:
        if prior.closure_type == "no_activity":
            return {
                "closure_id": str(prior.id),
                "closure_type": "no_activity",
                "date": today.isoformat(),
                "reason": prior.no_activity_reason,
                "submitted": True,
            }
        already = "a no-activity closure" if prior.closure_type == "no_activity" else "a closure"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"You have already submitted {already} for today.",
        )

    closure_id = uuid.uuid4()
    await session.execute(
        text("""
            INSERT INTO day_closures (id, officer_id, date, closure_type, no_activity_reason, created_at)
            VALUES (:id, :oid, :d, 'no_activity', :reason, :now)
        """).bindparams(
            id=closure_id, oid=current_user.user_id, d=today,
            reason=reason, now=datetime.now(timezone.utc),
        )
    )
    await session.commit()
    return {
        "closure_id": str(closure_id),
        "closure_type": "no_activity",
        "date": today.isoformat(),
        "reason": reason,
        "submitted": True,
    }


@router.get("/warning-status")
async def get_day_closure_warning_status(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    """Everything a client needs to decide whether to show the 17:30
    day-closure warning - computed SERVER-side.

    The client is deliberately not trusted to work this out itself: a
    device with the wrong timezone (or a user who changed it) would warn
    at the wrong moment or not at all. The client's only job is to
    render `warning_due`.

    Scope is field_officer and sales_officer only; admin and manager are
    excluded, and the separate manager daily-report gate is untouched.

    NOTE: this endpoint only REPORTS. It does not block logout - the
    logout gate remains exactly as it was, per the agreed scope for
    this task.
    """
    now = company_now()
    today = company_today()
    role = current_user.role

    required = role in ("field_officer", "sales_officer")

    # Sunday is non-working; company holidays come from holiday_calendar
    # (admin-maintained), not a hardcoded national-holiday list.
    is_working_day = is_weekly_working_day(today)
    if is_working_day:
        holiday = await session.execute(
            text("SELECT 1 FROM holiday_calendar WHERE date = :d").bindparams(d=today)
        )
        if holiday.first():
            is_working_day = False

    submitted = False
    if required:
        row = await session.execute(
            text("""
                SELECT 1 FROM day_closures
                WHERE officer_id = :oid AND date = :d AND is_deleted = false
            """).bindparams(oid=current_user.user_id, d=today)
        )
        submitted = row.first() is not None

    past_threshold = warning_threshold_passed(now)

    # `queued` is always false from the server's perspective: a queued
    # closure has by definition NOT reached the server. The mobile client
    # overlays its own local queue state on top of this response, which
    # is why the field exists here at all - so both clients report the
    # same shape.
    queued = False

    # An active emergency suppresses the nudge as well as the gate -
    # warning someone about a rule that is currently suspended is just
    # noise, and would contradict the logout behaviour.
    override = None
    if required:
        override = await active_override_for(session, current_user.user_id, role)

    warning_due = bool(
        required and is_working_day and past_threshold and not submitted and override is None
    )

    return {
        "required": required,
        "is_working_day": is_working_day,
        "company_date": today.isoformat(),
        "current_time": now.isoformat(),
        "submitted": submitted,
        "queued": queued,
        "warning_due": warning_due,
        # Surfaced so the UI can explain WHY no warning is showing,
        # rather than looking like the feature is broken.
        "emergency_override": override,
    }


@router.post("", response_model=DayClosureStatusResponse, status_code=status.HTTP_201_CREATED)
async def submit_day_closure(
    payload: DailyVisitTrackerSubmitRequest,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    farmer_use_case: Annotated[FarmerUseCase, Depends(get_farmer_use_case)],
) -> DayClosureStatusResponse:
    today = company_today()
    existing_row = await session.execute(
        text("SELECT id, visit_id FROM day_closures WHERE officer_id = :officer_id AND date = :today")
        .bindparams(officer_id=current_user.user_id, today=today)
    )
    existing = existing_row.mappings().first()
    if existing:
        visit_id = existing["visit_id"]
        detail = await _assemble_visit_detail(visit_id, session) if visit_id else None
        farmer_name = detail.get("farmer_name") if detail else None
        village = detail.get("village") if detail else None
        crop_name = detail.get("crop_name") if detail else None

        return DayClosureStatusResponse(
            closed_today=True,
            closure_id=existing["id"],
            visit_id=visit_id,
            farmer_name=farmer_name,
            village=village,
            crop_name=crop_name,
        )

    # Reuses the exact same visit-creation logic Daily Visit Tracker uses
    # - farmer resolution, trial-stock re-validation, and every satellite
    # table insert - rather than a second, parallel implementation.
    visit_result = await submit_daily_visit(
        payload=payload,
        current_user=current_user,
        session=session,
        farmer_use_case=farmer_use_case,
    )

    closure_id = uuid.uuid4()
    await session.execute(
        text("""
            INSERT INTO day_closures (id, officer_id, date, visit_id, created_at)
            VALUES (:id, :officer_id, :today, :visit_id, :now)
        """).bindparams(
            id=closure_id, officer_id=current_user.user_id, today=today,
            visit_id=visit_result.visit_id, now=visit_result.created_at,
        )
    )
    await session.commit()

    detail = await _assemble_visit_detail(visit_result.visit_id, session)
    farmer_name = detail.get("farmer_name") if detail else None
    village = detail.get("village") if detail else None
    crop_name = detail.get("crop_name") if detail else None

    return DayClosureStatusResponse(
        closed_today=True,
        closure_id=closure_id,
        visit_id=visit_result.visit_id,
        farmer_name=farmer_name,
        village=village,
        crop_name=crop_name,
    )


@router.get("", response_model=list[DayClosureAdminResponse])
async def list_day_closures(
    _current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    officer_id: Optional[uuid.UUID] = None,
    include_detail: bool = False,
) -> list[DayClosureAdminResponse]:
    query_str = """
        SELECT dc.id, dc.officer_id, u.full_name AS officer_name, dc.date,
               dc.closure_type, dc.no_activity_reason, dc.visit_id, dc.created_at,
               f.name AS farmer_name, f.village, f.district,
               c.name AS crop_name, vh.crop_status, vtd.demo_status, vs.purchased, vs.order_value,
               (SELECT COALESCE(jsonb_object_agg(field_key, value) FILTER (WHERE field_key IS NOT NULL), '{}'::jsonb) FROM custom_field_answers WHERE record_id = dc.visit_id) AS custom_field_answers
        FROM day_closures dc
        JOIN users u ON u.id = dc.officer_id
        LEFT JOIN visits v ON v.id = dc.visit_id
        LEFT JOIN farmers f ON f.id = v.farmer_id
        LEFT JOIN visit_crop_profiles vcp ON vcp.visit_id = dc.visit_id
        LEFT JOIN crops c ON c.id = vcp.crop_id
        LEFT JOIN visit_health vh ON vh.visit_id = dc.visit_id
        LEFT JOIN visit_trial_details vtd ON vtd.visit_id = dc.visit_id
        LEFT JOIN visit_sales vs ON vs.visit_id = dc.visit_id
        WHERE dc.is_deleted = false
    """
    params = {}
    if date_from:
        query_str += " AND dc.date >= :date_from"
        params["date_from"] = date_from
    if date_to:
        query_str += " AND dc.date <= :date_to"
        params["date_to"] = date_to
    if officer_id:
        query_str += " AND dc.officer_id = :officer_id"
        params["officer_id"] = officer_id

    query_str += " ORDER BY dc.date DESC"

    result = await session.execute(text(query_str).bindparams(**params))
    rows = result.all()

    responses = []
    for r in rows:
        visit_detail = await _assemble_visit_detail(r.visit_id, session) if (include_detail and r.visit_id) else None
        responses.append(
            DayClosureAdminResponse(
                id=r.id,
                officer_id=r.officer_id,
                officer_name=r.officer_name,
                date=r.date,
                visit_id=r.visit_id,
                farmer_name=r.farmer_name,
                village=r.village,
                district=r.district,
                crop_name=r.crop_name,
                crop_status=r.crop_status,
                demo_status=r.demo_status,
                purchased=r.purchased,
                order_value=float(r.order_value) if r.order_value is not None else None,
                created_at=r.created_at,
                visit_detail=visit_detail,
                custom_field_answers=r.custom_field_answers,
            )
        )
    return responses


@router.get("/missing-today", response_model=list[MissingClosureOfficer])
async def officers_missing_closure_today(
    _current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[MissingClosureOfficer]:
    today = company_today()
    result = await session.execute(
        text("""
            SELECT u.id AS officer_id, u.full_name AS officer_name, u.role
            FROM users u
            LEFT JOIN day_closures dc ON dc.officer_id = u.id AND dc.date = :today
            WHERE dc.id IS NULL AND u.role IN ('field_officer', 'sales_officer') AND u.is_active = true AND u.is_deleted = false
            ORDER BY u.full_name
        """).bindparams(today=today)
    )
    rows = result.all()

    return [
        MissingClosureOfficer(
            officer_id=r.officer_id,
            officer_name=r.officer_name,
            role=r.role
        ) for r in rows
    ]


# ---------------------------------------------------------------------
# Sales Officer day closure (202608260017)
# ---------------------------------------------------------------------
# Shares this router, the day_closures table, its UNIQUE(officer_id,
# date) duplicate guard, the logout gate, and the admin CRUD endpoints
# with the field-officer closure. Only the CONTENT differs, which is why
# closure_type exists rather than a parallel table/endpoint set.

_SALES_SELECT = """
    d.id, d.closure_id, d.district, d.dealer_name, d.village, d.dealer_contact,
    d.visit_purpose, d.visit_purpose_other_text, d.order_booked, d.order_value, d.amount_collected,
    d.new_dealer_details, d.reviewed_fo_visit, d.competitor_activity,
    d.stock_status, d.day_rating, d.remarks, d.created_at,
    c.officer_id, c.date, u.full_name AS officer_name,
    (SELECT COALESCE(jsonb_object_agg(field_key, value) FILTER (WHERE field_key IS NOT NULL), '{}'::jsonb) FROM custom_field_answers WHERE record_id = d.closure_id) AS custom_field_answers
"""

_SALES_FROM = """
    FROM sales_closure_details d
    JOIN day_closures c ON c.id = d.closure_id
    LEFT JOIN users u ON u.id = c.officer_id
"""


async def _sales_row_to_response(session: AsyncSession, row) -> SalesClosureResponse:
    imgs = await session.execute(
        text("SELECT image_url FROM sales_closure_images WHERE closure_id = :cid ORDER BY created_at")
        .bindparams(cid=row.closure_id)
    )
    data = dict(row._mapping)
    for money in ("order_value", "amount_collected"):
        if data.get(money) is not None:
            data[money] = float(data[money])
    return SalesClosureResponse(**data, images=[r.image_url for r in imgs.all()])


@router.post("/sales", response_model=SalesClosureResponse, status_code=status.HTTP_201_CREATED)
async def submit_sales_day_closure(
    payload: SalesClosureSubmitRequest,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> SalesClosureResponse:
    """Sales Officer files today's closure.

    Role-gated server-side, not just in the UI: a field officer's day is
    a farm visit and belongs on POST /day-closure, and allowing either
    role to post either shape would let the two closure types drift into
    meaning whatever the client decided.
    """
    if current_user.role not in ("sales_officer", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sales day closure is for Sales Officers. Field Officers submit a visit closure instead.",
        )

    # Server-side enforcement: an option flagged requires_description
    # must carry one. Checked BEFORE the duplicate check and any write,
    # so an invalid submission never creates a partial row.
    await validate_option_description(
        session, "sales_visit_purpose", payload.visit_purpose, payload.visit_purpose_other_text,
    )
    purpose_needs_desc = await option_requires_description(
        session, "sales_visit_purpose", payload.visit_purpose,
    )
    visit_purpose_other = clear_if_not_required(purpose_needs_desc, payload.visit_purpose_other_text)

    today = company_today()
    existing = await session.execute(
        text("SELECT id, closure_type FROM day_closures WHERE officer_id = :oid AND date = :today")
        .bindparams(oid=current_user.user_id, today=today)
    )
    prior = existing.first()
    if prior:
        if prior.closure_type == 'sales_activity':
            result = await session.execute(
                text(f"SELECT {_SALES_SELECT} {_SALES_FROM} WHERE d.closure_id = :cid").bindparams(cid=prior.id)
            )
            return await _sales_row_to_response(session, result.first())
        else:
            raise HTTPException(status_code=400, detail="Today's closure has already been submitted.")

    closure_id = uuid.uuid4()
    await session.execute(
        text("""
            INSERT INTO day_closures (id, officer_id, date, closure_type, created_at)
            VALUES (:id, :oid, :today, 'sales_activity', :now)
        """).bindparams(id=closure_id, oid=current_user.user_id, today=today, now=datetime.now(timezone.utc))
    )
    await session.execute(
        text("""
            INSERT INTO sales_closure_details (
                id, closure_id, district, visit_date, dealer_name, dealer_id, village,
                dealer_contact, visit_purpose, order_booked, order_value, amount_collected,
                new_dealer_details, reviewed_fo_visit, competitor_activity, stock_status,
                day_rating, remarks, visit_purpose_other_text
            ) VALUES (
                gen_random_uuid(), :cid, :district, :vdate, :dealer, :did, :village,
                :contact, :purpose, :booked, :ovalue, :collected,
                :newdealer, :foreview, :competitor, :stock, :rating, :remarks, :purpose_other
            )
        """).bindparams(
            cid=closure_id, district=payload.district, vdate=payload.visit_date or today,
            dealer=payload.dealer_name, did=payload.dealer_id, village=payload.village,
            contact=payload.dealer_contact, purpose=payload.visit_purpose,
            booked=payload.order_booked, ovalue=payload.order_value,
            collected=payload.amount_collected, newdealer=payload.new_dealer_details,
            foreview=payload.reviewed_fo_visit, competitor=payload.competitor_activity,
            stock=payload.stock_status, rating=payload.day_rating, remarks=payload.remarks,
            purpose_other=visit_purpose_other,
        )
    )
    for img in payload.images:
        await session.execute(
            text("""
                INSERT INTO sales_closure_images (id, closure_id, image_url, image_type)
                VALUES (gen_random_uuid(), :cid, :url, :itype)
            """).bindparams(cid=closure_id, url=img.image_url, itype=img.image_type)
        )

    # --- Custom Fields (transactional save) ---
    from app.application.services.custom_field_service import validate_and_save_custom_answers
    await validate_and_save_custom_answers(
        session=session,
        form_key="day_closure",
        record_id=closure_id,
        answers=payload.custom_field_answers,
        client_version=payload.config_version,
        user_id=current_user.user_id,
        role=current_user.role,
    )

    await session.commit()

    result = await session.execute(
        text(f"SELECT {_SALES_SELECT} {_SALES_FROM} WHERE d.closure_id = :cid").bindparams(cid=closure_id)
    )
    return await _sales_row_to_response(session, result.first())


@router.get("/sales/my", response_model=list[SalesClosureResponse])
async def list_my_sales_closures(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[SalesClosureResponse]:
    """A Sales Officer's own closure history - scoped to their own
    user_id in SQL, so one officer can never read another's."""
    result = await session.execute(
        text(f"SELECT {_SALES_SELECT} {_SALES_FROM} WHERE c.officer_id = :oid ORDER BY c.date DESC LIMIT 100")
        .bindparams(oid=current_user.user_id)
    )
    return [await _sales_row_to_response(session, r) for r in result.all()]


@router.get("/sales", response_model=list[SalesClosureResponse])
async def admin_list_sales_closures(
    _current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    officer_id: Optional[uuid.UUID] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    month: Optional[str] = None,
    district: Optional[str] = None,
    visit_purpose: Optional[str] = None,
) -> list[SalesClosureResponse]:
    """Admin/manager view with the filters section 5 asks for. Same
    role guard as the existing field-officer admin list."""
    clauses = ["c.is_deleted = false"]
    params: dict = {}
    if officer_id:
        clauses.append("c.officer_id = :oid"); params["oid"] = officer_id
    if date_from:
        clauses.append("c.date >= :dfrom"); params["dfrom"] = date_from
    if date_to:
        clauses.append("c.date <= :dto"); params["dto"] = date_to
    if month:
        # "YYYY-MM" - a whole-month filter is what an admin actually
        # asks for ("show me September"), and expressing it as a range
        # keeps the date index usable rather than forcing a function
        # call on every row.
        try:
            year_s, month_s = month.split("-")
            start = date(int(year_s), int(month_s), 1)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="month must be in YYYY-MM format.")
        end = date(start.year + 1, 1, 1) if start.month == 12 else date(start.year, start.month + 1, 1)
        clauses.append("c.date >= :mstart AND c.date < :mend")
        params["mstart"] = start; params["mend"] = end
    if district:
        clauses.append("d.district ILIKE :district"); params["district"] = f"%{district}%"
    if visit_purpose:
        clauses.append("d.visit_purpose = :purpose"); params["purpose"] = visit_purpose

    where = " AND ".join(clauses)
    result = await session.execute(
        text(f"SELECT {_SALES_SELECT} {_SALES_FROM} WHERE {where} ORDER BY c.date DESC LIMIT 500").bindparams(**params)
    )
    return [await _sales_row_to_response(session, r) for r in result.all()]


@router.get("/sales/{closure_id}", response_model=SalesClosureResponse)
async def get_sales_closure_detail(
    closure_id: uuid.UUID,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> SalesClosureResponse:
    """Full detail for one sales closure - every field plus images,
    officer name and submission date.

    Authorization is deliberately checked AFTER the row is fetched so an
    officer asking for someone else's closure gets a 404, not a 403: a
    403 would confirm the record exists, which is itself a small
    information leak about other officers' activity.
    """
    result = await session.execute(
        text(f"SELECT {_SALES_SELECT} {_SALES_FROM} WHERE d.closure_id = :cid AND c.is_deleted = false")
        .bindparams(cid=closure_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Sales closure not found.")

    is_oversight = current_user.role in ("admin", "manager")
    if not is_oversight and row.officer_id != current_user.user_id:
        raise HTTPException(status_code=404, detail="Sales closure not found.")

    return await _sales_row_to_response(session, row)


@router.put("/sales/{closure_id}", response_model=SalesClosureResponse)
async def admin_update_sales_closure(
    closure_id: uuid.UUID,
    payload: dict,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> SalesClosureResponse:
    """Admin correction of a submitted sales closure (spec section 5
    UPDATE). Partial - only the keys supplied are changed, matching the
    dynamic-SET pattern used by the other admin update endpoints."""
    existing = await session.execute(
        text("SELECT id FROM sales_closure_details WHERE closure_id = :cid").bindparams(cid=closure_id)
    )
    if not existing.first():
        raise HTTPException(status_code=404, detail="Sales closure not found.")

    editable = {
        "district", "dealer_name", "village", "dealer_contact", "visit_purpose",
        "order_booked", "order_value", "amount_collected", "new_dealer_details",
        "reviewed_fo_visit", "competitor_activity", "stock_status", "day_rating", "remarks",
    }
    fields = {k: v for k, v in payload.items() if k in editable}
    if not fields:
        raise HTTPException(status_code=400, detail="No editable fields were provided.")

    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    await session.execute(
        text(f"UPDATE sales_closure_details SET {set_clause}, updated_at = now() WHERE closure_id = :cid")
        .bindparams(**fields, cid=closure_id)
    )
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_sales_closure_edit",
        description=f"Admin edited sales day closure {closure_id}",
        context_data={"closure_id": str(closure_id), "fields": list(fields.keys())},
    )
    await session.commit()

    result = await session.execute(
        text(f"SELECT {_SALES_SELECT} {_SALES_FROM} WHERE d.closure_id = :cid").bindparams(cid=closure_id)
    )
    return await _sales_row_to_response(session, result.first())


# ---------------------------------------------------------------------
# Emergency overrides (approved §6)
# ---------------------------------------------------------------------
# Admin-only. Suspends the 17:30 warning and the logout gate for a
# scoped set of officers over a fixed window. Every action is audited -
# this is the control that switches off a compliance rule, so "who
# turned it off, when, and why" must always be answerable.


@router.post("/emergency-overrides", status_code=status.HTTP_201_CREATED)
async def admin_create_emergency_override(
    payload: dict,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    """Declare an emergency.

    reason, starts_at and ends_at are required. scope_role and
    scope_district are optional; omitting both means all officers.
    """
    reason = (payload.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required to declare an emergency override.")
    if not payload.get("starts_at") or not payload.get("ends_at"):
        raise HTTPException(status_code=400, detail="Both a start and an end time are required.")

    scope_role = payload.get("scope_role") or None
    if scope_role and scope_role not in ("field_officer", "sales_officer"):
        raise HTTPException(status_code=400, detail="scope_role must be field_officer or sales_officer.")

    new_id = uuid.uuid4()
    try:
        await session.execute(
            text("""
                INSERT INTO emergency_overrides
                    (id, reason, starts_at, ends_at, scope_role, scope_district, created_by)
                VALUES (:id, :reason, :starts, :ends, :role, :district, :uid)
            """).bindparams(
                id=new_id, reason=reason,
                starts=payload["starts_at"], ends=payload["ends_at"],
                role=scope_role, district=(payload.get("scope_district") or None),
                uid=current_user.user_id,
            )
        )
    except Exception:
        await session.rollback()
        # The DB enforces ends_at > starts_at; surface that as a clear
        # message rather than a raw constraint violation.
        raise HTTPException(status_code=400, detail="Check the dates - the end time must be after the start time.")

    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_emergency_override_declared",
        description=f"Admin declared an emergency override: {reason}",
        context_data={
            "override_id": str(new_id), "reason": reason,
            "starts_at": str(payload["starts_at"]), "ends_at": str(payload["ends_at"]),
            "scope_role": scope_role, "scope_district": payload.get("scope_district"),
        },
    )
    await session.commit()
    return {"id": str(new_id), "reason": reason, "is_active": True}


@router.get("/emergency-overrides")
async def admin_list_emergency_overrides(
    _current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[dict]:
    """All overrides, newest first, with a computed currently-active flag
    so the admin does not have to compare timestamps by eye."""
    rows = await session.execute(
        text("""
            SELECT o.id, o.reason, o.starts_at, o.ends_at, o.scope_role, o.scope_district,
                   o.is_active, o.cancelled_at, o.created_at,
                   u.full_name AS created_by_name,
                   (o.is_active AND o.starts_at <= now() AND o.ends_at >= now()) AS currently_active
            FROM emergency_overrides o
            LEFT JOIN users u ON u.id = o.created_by
            ORDER BY o.created_at DESC
            LIMIT 100
        """)
    )
    return [dict(r._mapping) for r in rows.all()]


@router.put("/emergency-overrides/{override_id}/cancel")
async def admin_cancel_emergency_override(
    override_id: uuid.UUID,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    """Manual kill switch (approved: end time PLUS manual disable).

    Sets is_active = false rather than deleting the row - an emergency
    that was declared and then withdrawn is exactly the kind of thing an
    audit needs to still be able to see.
    """
    existing = await session.execute(
        text("SELECT reason FROM emergency_overrides WHERE id = :id AND is_active = true")
        .bindparams(id=override_id)
    )
    row = existing.first()
    if not row:
        raise HTTPException(status_code=404, detail="No active override found with that id.")

    await session.execute(
        text("""
            UPDATE emergency_overrides
            SET is_active = false, cancelled_by = :uid, cancelled_at = now()
            WHERE id = :id
        """).bindparams(uid=current_user.user_id, id=override_id)
    )
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_emergency_override_cancelled",
        description=f"Admin cancelled emergency override: {row.reason}",
        context_data={"override_id": str(override_id)},
    )
    await session.commit()
    return {"id": str(override_id), "is_active": False}
