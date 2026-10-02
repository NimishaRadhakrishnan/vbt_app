"""
Field Visit Router endpoints.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional, Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.use_cases.visit_use_case import VisitUseCase
from app.core.container import get_visit_use_case
from app.domain.value_objects.role import Role
from app.infrastructure.database.session import get_db_session
from app.presentation.api.v1.dependencies import CurrentUser, require_role
from app.presentation.schemas.visit_schemas import (
    EndVisitRequest,
    StartVisitRequest,
    TrialProductResponse,
    VisitResponse,
)

router = APIRouter(prefix="/visits", tags=["visits"])


@router.post("/start", response_model=VisitResponse, status_code=status.HTTP_201_CREATED)
async def start_visit(
    payload: StartVisitRequest,
    current_user: CurrentUser,
    use_case: Annotated[VisitUseCase, Depends(get_visit_use_case)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> VisitResponse:
    # Trial validation (section 4): required when is_trial, ignored/cleared
    # otherwise - a field officer marking "No" should never be blocked by
    # anything below this toggle.
    if payload.is_trial and not payload.trial_products:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one product is required when Trial is Yes.",
        )
    trial_products = payload.trial_products if payload.is_trial else []

    result = await use_case.start_visit(
        user_id=current_user.user_id,
        visit_type=payload.visit_type,
        lat=payload.latitude,
        lng=payload.longitude,
        farmer_id=payload.farmer_id,
        dealer_id=payload.dealer_id,
        photo_url_farmer=payload.photo_url_farmer,
        photo_url_farm=payload.photo_url_farm,
        crop=payload.crop,
        purpose=payload.purpose,
        products_demonstrated=payload.products_demonstrated,
        is_trial=payload.is_trial,
    )

    # Trial product rows (own child table - see visit_trial_products
    # migration). quantity_leftover defaults to quantity_given at start;
    # end_visit() below is where it gets adjusted down.
    for entry in trial_products:
        await session.execute(
            text(
                """
                INSERT INTO visit_trial_products (id, visit_id, product_id, quantity_given, quantity_leftover, created_at)
                VALUES (gen_random_uuid(), :visit_id, :product_id, :qty, :qty, now())
                """
            ).bindparams(visit_id=result.id, product_id=entry.product_id, qty=entry.quantity_given)
        )
    if trial_products:
        await session.commit()

    return await _to_response(result, session)


@router.post("/end", response_model=VisitResponse)
async def end_visit(
    payload: EndVisitRequest,
    current_user: CurrentUser,
    use_case: Annotated[VisitUseCase, Depends(get_visit_use_case)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> VisitResponse:
    active = await use_case.get_active_visit(current_user.user_id)
    if not active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No active visit session found.")

    result = await use_case.end_visit(
        user_id=current_user.user_id,
        lat=payload.latitude,
        lng=payload.longitude,
        task_completed=payload.task_completed,
        next_visit_date=payload.next_visit_date,
        voice_notes_url=payload.voice_notes_url,
        voice_notes_transcript_ta=payload.voice_notes_transcript_ta,
        voice_notes_transcript_en=payload.voice_notes_transcript_en,
        farmers_covered=payload.farmers_covered,
        demos_conducted=payload.demos_conducted,
        villages_covered=payload.villages_covered,
        cents_covered=payload.cents_covered,
        conversions=payload.conversions,
    )

    if active.is_trial and payload.trial_leftovers:
        for entry in payload.trial_leftovers:
            await session.execute(
                text(
                    """
                    UPDATE visit_trial_products SET quantity_leftover = :qty
                    WHERE visit_id = :visit_id AND product_id = :product_id
                    """
                ).bindparams(visit_id=result.id, product_id=entry.product_id, qty=entry.quantity_leftover)
            )
        await session.commit()

    return await _to_response(result, session)


@router.get("/active", response_model=Optional[VisitResponse])
async def get_active_visit(
    current_user: CurrentUser,
    use_case: Annotated[VisitUseCase, Depends(get_visit_use_case)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> Optional[VisitResponse]:
    result = await use_case.get_active_visit(current_user.user_id)
    return await _to_response(result, session) if result else None


@router.get("/history", response_model=list[VisitResponse])
async def get_history(
    current_user: CurrentUser,
    use_case: Annotated[VisitUseCase, Depends(get_visit_use_case)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    officer_id: Optional[uuid.UUID] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[VisitResponse]:
    is_privileged = current_user.role in (Role.ADMIN.value, Role.MANAGER.value)
    if officer_id is not None and officer_id != current_user.user_id and not is_privileged:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to view this officer's visit history.")
    effective_user_id = officer_id if (officer_id is not None and is_privileged) else current_user.user_id

    result = await use_case.get_visit_history(effective_user_id, limit=limit, offset=offset)
    return [await _to_response(v, session) for v in result]


@router.get("/trials")
async def list_trials(
    current_user: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    officer_id: Optional[uuid.UUID] = None,
    month: Optional[str] = None,  # "YYYY-MM"
) -> list[dict]:
    """"All trials this month" / leftover-stock reporting (section 4) -
    a plain filtered query now that trial data is structured instead of
    free text."""
    query = """
        SELECT v.id AS visit_id, v.user_id, u.full_name AS officer_name, v.start_time,
               vtp.product_id, p.name AS product_name, vtp.quantity_given, vtp.quantity_leftover
        FROM visits v
        JOIN visit_trial_products vtp ON vtp.visit_id = v.id
        JOIN products p ON p.id = vtp.product_id
        JOIN users u ON u.id = v.user_id
        WHERE v.is_trial = true
    """
    params: dict = {}
    if officer_id:
        query += " AND v.user_id = :officer_id"
        params["officer_id"] = officer_id
    if month:
        query += " AND to_char(v.start_time, 'YYYY-MM') = :month"
        params["month"] = month
    query += " ORDER BY v.start_time DESC"

    result = await session.execute(text(query).bindparams(**params))
    return [dict(row._mapping) for row in result.all()]


@router.get("/kpi-summary")
async def kpi_summary(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    officer_id: Optional[uuid.UUID] = None,
    month: Optional[str] = None,  # "YYYY-MM", defaults to current month
) -> dict:
    """Per-officer, per-month KPI rollup (section 5) - farmers/demos/
    villages/cents/conversions, aggregated straight off the visits table
    now that these are structured columns instead of free text. Officer
    identity is the real user_id (never a typed name), so there's no
    name-variant-splitting to normalize in the first place."""
    is_privileged = current_user.role in (Role.ADMIN.value, Role.MANAGER.value)
    target_officer = officer_id if (officer_id and is_privileged) else current_user.user_id
    target_month = month or datetime.utcnow().strftime("%Y-%m")

    result = await session.execute(
        text(
            """
            SELECT
                COALESCE(SUM(farmers_covered), 0) AS farmers_covered,
                COALESCE(SUM(demos_conducted), 0) AS demos_conducted,
                COALESCE(SUM(cents_covered), 0) AS cents_covered,
                COALESCE(SUM(conversions), 0) AS conversions,
                COUNT(DISTINCT unnest_village) AS villages_covered
            FROM visits v
            LEFT JOIN LATERAL unnest(COALESCE(v.villages_covered, ARRAY[]::text[])) AS unnest_village ON true
            WHERE v.user_id = :officer_id AND to_char(v.start_time, 'YYYY-MM') = :month
            """
        ).bindparams(officer_id=target_officer, month=target_month)
    )
    row = result.first()
    return {
        "officer_id": str(target_officer),
        "month": target_month,
        "farmers_covered": int(row.farmers_covered or 0),
        "demos_conducted": int(row.demos_conducted or 0),
        "cents_covered": float(row.cents_covered or 0),
        "conversions": int(row.conversions or 0),
        "villages_covered": int(row.villages_covered or 0),
    }


async def _to_response(visit, session: AsyncSession) -> VisitResponse:
    trial_products: list[TrialProductResponse] = []
    if visit.is_trial:
        result = await session.execute(
            text(
                """
                SELECT vtp.product_id, p.name AS product_name, vtp.quantity_given, vtp.quantity_leftover
                FROM visit_trial_products vtp
                JOIN products p ON p.id = vtp.product_id
                WHERE vtp.visit_id = :visit_id
                """
            ).bindparams(visit_id=visit.id)
        )
        trial_products = [
            TrialProductResponse(
                product_id=row.product_id,
                product_name=row.product_name,
                quantity_given=float(row.quantity_given),
                quantity_leftover=float(row.quantity_leftover),
            )
            for row in result.all()
        ]

    return VisitResponse(
        id=visit.id,
        user_id=visit.user_id,
        visit_type=visit.visit_type,
        start_time=visit.start_time,
        location_start_lat=visit.location_start_lat,
        location_start_lng=visit.location_start_lng,
        farmer_id=visit.farmer_id,
        dealer_id=visit.dealer_id,
        end_time=visit.end_time,
        duration_seconds=visit.duration_seconds,
        location_end_lat=visit.location_end_lat,
        location_end_lng=visit.location_end_lng,
        photo_url_farmer=visit.photo_url_farmer,
        photo_url_farm=visit.photo_url_farm,
        crop=visit.crop,
        purpose=visit.purpose,
        products_demonstrated=visit.products_demonstrated,
        task_completed=visit.task_completed,
        next_visit_date=visit.next_visit_date,
        voice_notes_url=visit.voice_notes_url,
        voice_notes_transcript_ta=visit.voice_notes_transcript_ta,
        voice_notes_transcript_en=visit.voice_notes_transcript_en,
        created_at=visit.created_at,
        is_trial=visit.is_trial,
        trial_products=trial_products,
        farmers_covered=visit.farmers_covered,
        demos_conducted=visit.demos_conducted,
        villages_covered=visit.villages_covered,
        cents_covered=visit.cents_covered,
        conversions=visit.conversions,
    )
