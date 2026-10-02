"""
Farmer Router endpoints.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Optional, Annotated

from fastapi import APIRouter, Depends, status, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.use_cases.farmer_use_case import FarmerUseCase
from app.core.container import get_farmer_use_case
from app.infrastructure.audit.audit_log import write_audit_log
from app.infrastructure.database.session import get_db_session
from app.presentation.api.v1.routers.stock_router import record_movement, reverse_movements_for_ref
from app.presentation.api.v1.dependencies import CurrentUser
from app.presentation.schemas.farmer_schemas import FarmerResponse, RegisterFarmerRequest, TrialProductDetail, TrialUpdateRequest

router = APIRouter(prefix="/farmers", tags=["farmers"])


async def _validate_and_price_trial_stock(
    session: AsyncSession,
    officer_id: uuid.UUID,
    trial_products: list,
    exclude_farmer_id: Optional[uuid.UUID] = None,
) -> dict[uuid.UUID, str]:
    """Live stock check shared by create and update, now reading the
    single stock ledger.

    Previously this computed its own remaining figure from
    officer_product_stock + two separate "given" subqueries - a THIRD
    formula for the same question, alongside trial_router's and
    sales_stock_router's, and one that likewise never wrote anything
    back. A farmer-registration trial therefore reduced nothing at all.

    Now stock is SUM(stock_ledger.qty_delta), the same source every other
    caller uses, and the caller writes a `trial_given` row so the
    giveaway is actually deducted.

    exclude_farmer_id is no longer needed for correctness on the UPDATE
    path - that path reverses this farmer's previous ledger rows before
    re-checking, so the pool it sees is already correct. The parameter is
    kept for signature compatibility and ignored."""
    if not trial_products:
        return {}
    product_ids = [tp.product_id for tp in trial_products]
    result = await session.execute(
        text("""
            SELECT p.id AS product_id, p.name AS product_name,
                   COALESCE(SUM(sl.qty_delta), 0) AS remaining
            FROM products p
            LEFT JOIN stock_ledger sl
                   ON sl.product_id = p.id AND sl.officer_id = :officer_id
            WHERE p.id = ANY(:product_ids)
            GROUP BY p.id, p.name
        """).bindparams(officer_id=officer_id, product_ids=product_ids)
    )
    rows = {row.product_id: (row.product_name, float(row.remaining)) for row in result.all()}
    for tp in trial_products:
        if tp.product_id not in rows:
            raise HTTPException(status_code=404, detail="One of the selected products was not found.")
        product_name, remaining = rows[tp.product_id]
        if tp.quantity > remaining:
            raise HTTPException(status_code=400, detail=f"Insufficient stock for {product_name}. Available: {remaining}")
    return {pid: name for pid, (name, _) in rows.items()}


@router.post("/", response_model=FarmerResponse, status_code=status.HTTP_201_CREATED)
async def register_farmer(
    payload: RegisterFarmerRequest,
    current_user: CurrentUser,
    use_case: Annotated[FarmerUseCase, Depends(get_farmer_use_case)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> FarmerResponse:
    # Only Field Officers submit trial data with a registration (matches
    # the web form only showing this section to that role) - silently
    # ignore trial fields from any other role rather than trusting a
    # client-crafted payload to decide whether stock gets touched.
    is_field_officer = current_user.role == "field_officer"
    trial_conducted = payload.trial_conducted and is_field_officer
    trial_products = payload.trial_products if trial_conducted else []

    if trial_conducted and not trial_products:
        raise HTTPException(status_code=400, detail="Select at least one product used in the trial, or turn off Trial Conducted.")

    # --- Stock validation BEFORE any write ---
    stock_by_product = await _validate_and_price_trial_stock(session, current_user.user_id, trial_products)

    # --- Farmer creation (add + flush, no commit yet - use_case.register_farmer
    # -> repository.add() only flushes) and trial rows share this same
    # request-scoped session, so if anything below raises, get_db_session's
    # own except-block rolls back everything together, including the
    # farmer row - one transaction, no partial writes. ---
    try:
        farmer = await use_case.register_farmer(
            name=payload.name,
            phone=payload.phone,
            village=payload.village,
            taluk=payload.taluk,
            district=payload.district,
            crop=payload.crop,
            cents=payload.cents,
            location_lat=payload.location_lat,
            location_lng=payload.location_lng,
            photo_url=payload.photo_url,
            created_by=current_user.user_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))

    if trial_conducted:
        await session.execute(
            text("UPDATE farmers SET trial_conducted = true WHERE id = :id").bindparams(id=farmer.id)
        )
        for tp in trial_products:
            await session.execute(
                text("""
                    INSERT INTO farmer_trial_products (id, farmer_id, product_id, quantity, created_by)
                    VALUES (gen_random_uuid(), :farmer_id, :product_id, :quantity, :created_by)
                """).bindparams(farmer_id=farmer.id, product_id=tp.product_id, quantity=tp.quantity, created_by=current_user.user_id)
            )
            # Same transaction as the farmer + trial rows, so a
            # registration trial can never be recorded without its stock
            # movement. This path previously deducted nothing at all.
            await record_movement(
                session,
                officer_id=current_user.user_id,
                product_id=tp.product_id,
                quantity=tp.quantity,
                movement_type="trial_given",
                created_by=current_user.user_id,
                ref_type="farmer",
                ref_id=farmer.id,
                remarks="Trial given at farmer registration",
            )
        farmer.trial_conducted = True

    trial_detail = [
        TrialProductDetail(product_id=tp.product_id, product_name=stock_by_product.get(tp.product_id, ""), quantity=tp.quantity)
        for tp in trial_products
    ]
    return _to_response(farmer, trial_detail)


@router.patch("/{farmer_id}/trial", response_model=FarmerResponse)
async def update_farmer_trial(
    farmer_id: uuid.UUID,
    payload: TrialUpdateRequest,
    current_user: CurrentUser,
    use_case: Annotated[FarmerUseCase, Depends(get_farmer_use_case)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> FarmerResponse:
    # Lets a Field Officer add/edit trial info on a farmer they already
    # registered - the registration form's Trial Conducted section only
    # covers the moment of registration; a trial started later (or one
    # whose quantities need correcting) had no way back in until now.
    if current_user.role != "field_officer":
        raise HTTPException(status_code=403, detail="Only Field Officers can update trial information.")

    farmer = await use_case.get_farmer_profile(farmer_id)
    if not farmer:
        raise HTTPException(status_code=404, detail="Farmer not found.")
    if farmer.created_by != current_user.user_id:
        raise HTTPException(status_code=403, detail="You can only update trial information for farmers you registered.")

    trial_conducted = payload.trial_conducted
    trial_products = payload.trial_products if trial_conducted else []
    if trial_conducted and not trial_products:
        raise HTTPException(status_code=400, detail="Select at least one product used in the trial, or turn off Trial Conducted.")

    # Delete this farmer's existing trial rows FIRST, in the same
    # transaction, so the stock check below sees the pool as it will
    # actually be after this update - correctly excluding quantities
    # that are being replaced rather than treating them as an additional
    # commitment on top of the new numbers.
    await session.execute(text("DELETE FROM farmer_trial_products WHERE farmer_id = :farmer_id").bindparams(farmer_id=farmer_id))

    # Reverse this farmer's previous stock deductions before re-checking.
    # Compensating rows, not deletes: the ledger is append-only, and an
    # officer querying why their stock moved is owed the full sequence,
    # including the correction.
    await reverse_movements_for_ref(
        session,
        ref_type="farmer",
        ref_id=farmer_id,
        created_by=current_user.user_id,
        remarks="Reversed - farmer trial details edited",
    )

    stock_by_product = await _validate_and_price_trial_stock(
        session, current_user.user_id, trial_products, exclude_farmer_id=farmer_id
    )

    await session.execute(
        text("UPDATE farmers SET trial_conducted = :tc WHERE id = :id").bindparams(tc=trial_conducted, id=farmer_id)
    )
    for tp in trial_products:
        await session.execute(
            text("""
                INSERT INTO farmer_trial_products (id, farmer_id, product_id, quantity, created_by)
                VALUES (gen_random_uuid(), :farmer_id, :product_id, :quantity, :created_by)
            """).bindparams(farmer_id=farmer_id, product_id=tp.product_id, quantity=tp.quantity, created_by=current_user.user_id)
        )
        await record_movement(
            session,
            officer_id=current_user.user_id,
            product_id=tp.product_id,
            quantity=tp.quantity,
            movement_type="trial_given",
            created_by=current_user.user_id,
            ref_type="farmer",
            ref_id=farmer_id,
            remarks="Trial given at farmer registration (edited)",
        )

    farmer.trial_conducted = trial_conducted
    trial_detail = [
        TrialProductDetail(product_id=tp.product_id, product_name=stock_by_product.get(tp.product_id, ""), quantity=tp.quantity)
        for tp in trial_products
    ]
    return _to_response(farmer, trial_detail)


@router.get("/search", response_model=list[FarmerResponse])
async def search_farmers(
    current_user: CurrentUser,
    use_case: Annotated[FarmerUseCase, Depends(get_farmer_use_case)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    village: Optional[str] = None,
    taluk: Optional[str] = None,
    district: Optional[str] = None,
    crop: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[FarmerResponse]:
    result = await use_case.search_farmers(
        village=village, taluk=taluk, district=district, crop=crop,
        date_from=date_from, date_to=date_to, limit=limit, offset=offset
    )
    # Scope to own assigned/created farmers for non-admins
    if current_user.role != "admin":
        result = [f for f in result if f.created_by == current_user.user_id]
    trial_by_farmer = await _load_trial_products(session, [f.id for f in result])
    return [_to_response(f, trial_by_farmer.get(f.id)) for f in result]


@router.get("/{farmer_id}", response_model=Optional[FarmerResponse])
async def get_farmer_profile(
    farmer_id: uuid.UUID,
    current_user: CurrentUser,
    use_case: Annotated[FarmerUseCase, Depends(get_farmer_use_case)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> Optional[FarmerResponse]:
    result = await use_case.get_farmer_profile(farmer_id)
    if not result:
        return None
    # Scope to own assigned/created farmers for non-admins
    if current_user.role != "admin" and result.created_by != current_user.user_id:
        raise HTTPException(status_code=403, detail="Forbidden: Access to this farmer profile is restricted.")
    trial_by_farmer = await _load_trial_products(session, [result.id])
    return _to_response(result, trial_by_farmer.get(result.id))


def _to_response(farmer, trial_products: Optional[list[TrialProductDetail]] = None) -> FarmerResponse:
    return FarmerResponse(
        id=farmer.id,
        name=farmer.name,
        phone=farmer.phone,
        village=farmer.village,
        taluk=farmer.taluk,
        district=farmer.district,
        crop=farmer.crop,
        cents=farmer.cents,
        location_lat=farmer.location_lat,
        location_lng=farmer.location_lng,
        photo_url=farmer.photo_url,
        created_by=farmer.created_by,
        trial_conducted=getattr(farmer, "trial_conducted", False),
        trial_products=trial_products or [],
        created_at=farmer.created_at,
        updated_at=farmer.updated_at,
    )


async def _load_trial_products(session: AsyncSession, farmer_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[TrialProductDetail]]:
    if not farmer_ids:
        return {}
    result = await session.execute(
        text("""
            SELECT ftp.farmer_id, ftp.product_id, p.name AS product_name, ftp.quantity
            FROM farmer_trial_products ftp
            JOIN products p ON p.id = ftp.product_id
            WHERE ftp.farmer_id = ANY(:farmer_ids)
        """).bindparams(farmer_ids=farmer_ids)
    )
    by_farmer: dict[uuid.UUID, list[TrialProductDetail]] = {}
    for row in result.all():
        by_farmer.setdefault(row.farmer_id, []).append(
            TrialProductDetail(product_id=row.product_id, product_name=row.product_name, quantity=float(row.quantity))
        )
    return by_farmer


@router.delete("/{farmer_id}", status_code=status.HTTP_200_OK)
async def delete_farmer(
    farmer_id: uuid.UUID,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    """Remove a farmer, hard or soft depending on what is attached.

    This used to be an unguarded ``DELETE FROM farmers``. Any farmer who
    had ever been visited was protected by ``check_visit_target``, so the
    statement raised CheckViolation and the admin got a 500 with no
    explanation. A farmer who did not exist returned "success".

    The rule now matches the one already used for users: records that
    carry history are archived, never destroyed, and the caller is told
    which happened.
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Only administrators can delete farmers.",
        )

    existing = await session.execute(
        text("SELECT name FROM farmers WHERE id = :id AND is_deleted = false").bindparams(id=farmer_id)
    )
    row = existing.first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Farmer not found.")
    farmer_name = row.name

    linked = await session.execute(
        text("SELECT count(*) FROM visits WHERE farmer_id = :id").bindparams(id=farmer_id)
    )
    visit_count = int(linked.scalar() or 0)

    if visit_count == 0:
        await session.execute(text("DELETE FROM farmers WHERE id = :id").bindparams(id=farmer_id))
        outcome, message = "deleted", f"{farmer_name} was deleted."
    else:
        await session.execute(
            text(
                "UPDATE farmers SET is_deleted = true, updated_at = now(), updated_by = :actor "
                "WHERE id = :id"
            ).bindparams(id=farmer_id, actor=current_user.user_id)
        )
        outcome = "archived"
        message = (
            f"{farmer_name} has {visit_count} recorded "
            f"visit{'s' if visit_count != 1 else ''} and was archived instead of deleted. "
            "The visit history is kept."
        )

    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type=f"farmer_{outcome}",
        description=f"Admin {outcome} farmer {farmer_id}",
        context_data={"farmer_id": str(farmer_id), "visit_count": visit_count},
    )
    await session.commit()
    return {"status": "success", "result": outcome, "message": message}
