"""
Dealer and Inventory Router endpoints.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Optional, Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.use_cases.dealer_use_case import DealerUseCase
from app.core.container import get_dealer_use_case
from app.infrastructure.database.session import get_db_session
from app.presentation.api.v1.dependencies import CurrentUser, require_role
from app.domain.value_objects.role import Role
from app.presentation.schemas.dealer_schemas import (
    DealerApprovalRequest,
    DealerOrderResponse,
    DealerResponse,
    DealerStockResponse,
    DuplicateCheckResponse,
    PlaceOrderRequest,
    PossibleDuplicateDealer,
    ProductResponse,
    RegisterDealerRequest,
    StockAuditRequest,
)

router = APIRouter(prefix="/dealers", tags=["dealers"])


@router.get("/check-duplicate", response_model=DuplicateCheckResponse)
async def check_duplicate_dealer(
    current_user: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER, Role.SALES_OFFICER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    name: Optional[str] = None,
    phone: Optional[str] = None,
    gst_number: Optional[str] = None,
    district: Optional[str] = None,
) -> DuplicateCheckResponse:
    # Section 4: a *soft* warning, not a hard block - phone uniqueness is
    # still enforced as a real DB constraint (see register_dealer below),
    # but name/GST/district-proximity matches are only ever "you might
    # want to check this first," surfaced before the officer submits so
    # they can pick the existing dealer instead of creating a near-dupe.
    candidates: list[PossibleDuplicateDealer] = []

    if phone:
        result = await session.execute(
            text("SELECT id, name, phone, district, village, gst_number FROM dealers WHERE phone = :phone AND is_deleted = false")
            .bindparams(phone=phone)
        )
        for row in result.all():
            candidates.append(PossibleDuplicateDealer(id=row.id, name=row.name, phone=row.phone, district=row.district, village=row.village, gst_number=row.gst_number, match_reason="phone"))

    if gst_number:
        result = await session.execute(
            text("SELECT id, name, phone, district, village, gst_number FROM dealers WHERE gst_number = :gst AND is_deleted = false")
            .bindparams(gst=gst_number)
        )
        for row in result.all():
            if not any(c.id == row.id for c in candidates):
                candidates.append(PossibleDuplicateDealer(id=row.id, name=row.name, phone=row.phone, district=row.district, village=row.village, gst_number=row.gst_number, match_reason="gst_number"))

    if name and district:
        result = await session.execute(
            text(
                "SELECT id, name, phone, district, village, gst_number FROM dealers "
                "WHERE is_deleted = false AND district = :district AND name ILIKE :name_pattern"
            ).bindparams(district=district, name_pattern=f"%{name.strip()}%")
        )
        for row in result.all():
            if not any(c.id == row.id for c in candidates):
                candidates.append(PossibleDuplicateDealer(id=row.id, name=row.name, phone=row.phone, district=row.district, village=row.village, gst_number=row.gst_number, match_reason="name_and_district"))

    return DuplicateCheckResponse(has_possible_duplicates=len(candidates) > 0, candidates=candidates)


@router.post("/", response_model=DealerResponse, status_code=status.HTTP_201_CREATED)
async def register_dealer(
    payload: RegisterDealerRequest,
    current_user: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER, Role.SALES_OFFICER))],
    use_case: Annotated[DealerUseCase, Depends(get_dealer_use_case)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> DealerResponse:
    # Sales Officers can add a dealer, but it sits pending until an
    # Admin/Manager approves it — they cannot self-approve by any payload
    # field, since the status is decided here from the caller's own role,
    # never from client input.
    is_self_approving_role = current_user.role in ("admin", "manager")

    # Re-run the same possible-duplicate search server-side (section 4) -
    # the mobile app is expected to call /check-duplicate first and set
    # duplicate_check_acknowledged once the officer has seen and
    # dismissed any matches, but that flag alone can't be trusted from
    # the client; a fresh GST/phone match found here still blocks.
    if payload.gst_number:
        gst_clash = await session.execute(
            text("SELECT id FROM dealers WHERE gst_number = :gst AND is_deleted = false").bindparams(gst=payload.gst_number)
        )
        if gst_clash.first() and not payload.duplicate_check_acknowledged:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A dealer with similar details already exists.",
            )

    try:
        result = await use_case.register_dealer(
            name=payload.name,
            phone=payload.phone,
            district=payload.district,
            village=payload.village,
            taluk=payload.taluk,
            location_lat=payload.location_lat,
            location_lng=payload.location_lng,
            address=payload.address,
            contact_person=payload.contact_person,
            alternate_contact=payload.alternate_contact,
            state=payload.state,
            pin_code=payload.pin_code,
            gst_number=payload.gst_number,
            dealer_type=payload.dealer_type,
            remarks=payload.remarks,
            requested_by=current_user.user_id,
            initial_status="active" if is_self_approving_role else "pending_approval",
        )
    except ValueError as e:
        # register_dealer's own phone-uniqueness check (a real DB
        # constraint, not a soft warning) - section 4's exact wording.
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A dealer with similar details already exists.")
    return _to_dealer_response(result)


@router.get("/search", response_model=list[DealerResponse])
async def search_dealers(
    current_user: CurrentUser,
    use_case: Annotated[DealerUseCase, Depends(get_dealer_use_case)],
    district: Optional[str] = None,
    taluk: Optional[str] = None,
    status_filter: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[DealerResponse]:
    # Default view (no status_filter given) only shows active dealers —
    # pending/rejected dealers never leak into normal ordering flows.
    # Only Admin/Manager may explicitly request other statuses (e.g. the
    # approval queue via ?status_filter=pending_approval).
    is_privileged = current_user.role in ("admin", "manager")
    effective_status = status_filter if (status_filter and is_privileged) else "active"
    result = await use_case.search_dealers(
        district=district, taluk=taluk, status=effective_status, date_from=date_from, date_to=date_to, limit=limit, offset=offset
    )
    return [_to_dealer_response(d) for d in result]


@router.patch("/{dealer_id}/approval", response_model=DealerResponse)
async def set_dealer_approval(
    dealer_id: uuid.UUID,
    payload: DealerApprovalRequest,
    _access: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    use_case: Annotated[DealerUseCase, Depends(get_dealer_use_case)],
) -> DealerResponse:
    try:
        result = await use_case.set_dealer_approval(dealer_id, payload.approve, updated_by=_access.user_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return _to_dealer_response(result)


@router.get("/orders/all", response_model=list[DealerOrderResponse])
async def list_all_orders(
    use_case: Annotated[DealerUseCase, Depends(get_dealer_use_case)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    _access: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    status_filter: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[DealerOrderResponse]:
    result = await use_case.list_dealer_orders(dealer_id=None, status=status_filter, limit=limit, offset=offset)
    paid_by_order = await _paid_amounts_by_order(session, [o.id for o in result])
    return [_to_order_response(o, amount_paid=paid_by_order.get(o.id, 0.0)) for o in result]


@router.post("/{dealer_id}/stock", response_model=DealerStockResponse)
async def audit_stock(
    dealer_id: uuid.UUID,
    payload: StockAuditRequest,
    use_case: Annotated[DealerUseCase, Depends(get_dealer_use_case)],
    _access: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))],
) -> DealerStockResponse:
    result = await use_case.audit_stock(
        dealer_id=dealer_id,
        product_id=payload.product_id,
        stock_qty=payload.stock_qty,
        notes=payload.notes,
        updated_by=_access.user_id,
    )
    return DealerStockResponse(
        id=result.id,
        dealer_id=result.dealer_id,
        product_id=result.product_id,
        stock_qty=result.stock_qty,
        low_stock_threshold=result.low_stock_threshold,
        last_updated_at=result.last_updated_at,
    )


@router.post("/{dealer_id}/orders", response_model=DealerOrderResponse, status_code=status.HTTP_201_CREATED)
async def place_order(
    dealer_id: uuid.UUID,
    payload: PlaceOrderRequest,
    current_user: CurrentUser,
    use_case: Annotated[DealerUseCase, Depends(get_dealer_use_case)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    _access: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER, Role.SALES_OFFICER))],
) -> DealerOrderResponse:
    items_list = [{"product_id": str(item.product_id), "quantity": item.quantity} for item in payload.items]
    result = await use_case.place_order(
        dealer_id=dealer_id,
        created_by=current_user.user_id,
        items=items_list,
        comments=payload.comments,
        payment_deadline=payload.payment_deadline,
        payment_terms=payload.payment_terms,
    )

    amount_paid = 0.0
    if payload.initial_payment_amount and payload.initial_payment_amount > 0:
        if payload.initial_payment_amount > result.total_amount:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Initial payment cannot exceed the order total.")
        await session.execute(
            text(
                """
                INSERT INTO dealer_payments (id, dealer_order_id, amount, payment_date, method, collected_by, collection_status, created_at)
                VALUES (gen_random_uuid(), :order_id, :amount, CURRENT_DATE, :method, :officer_id, 'collected', now())
                """
            ).bindparams(order_id=result.id, amount=payload.initial_payment_amount, method=payload.initial_payment_method, officer_id=current_user.user_id)
        )
        await session.commit()
        amount_paid = payload.initial_payment_amount

    return _to_order_response(result, amount_paid=amount_paid)


@router.get("/{dealer_id}/orders", response_model=list[DealerOrderResponse])
async def list_orders(
    dealer_id: uuid.UUID,
    use_case: Annotated[DealerUseCase, Depends(get_dealer_use_case)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    # Widened from admin/manager-only: a Sales Officer needs to see their
    # own dealer's purchase/payment history for the dealer profile
    # (section 5) - this was a real pre-existing gap, not a change the
    # spec asked for directly, but the dealer profile it's building
    # toward can't work without it.
    _access: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER, Role.SALES_OFFICER))],
    status_filter: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[DealerOrderResponse]:
    result = await use_case.list_dealer_orders(dealer_id=dealer_id, status=status_filter, limit=limit, offset=offset)
    paid_by_order = await _paid_amounts_by_order(session, [o.id for o in result])
    return [_to_order_response(o, amount_paid=paid_by_order.get(o.id, 0.0)) for o in result]


@router.get("/products/catalog", response_model=list[ProductResponse])
async def list_products(
    current_user: CurrentUser,
    use_case: Annotated[DealerUseCase, Depends(get_dealer_use_case)],
) -> list[ProductResponse]:
    result = await use_case.list_products()
    return [
        ProductResponse(
            id=p.id,
            name=p.name,
            category=p.category,
            sku_code=p.sku_code,
            price=p.price,
            description=p.description,
        )
        for p in result
    ]


def _to_dealer_response(dealer) -> DealerResponse:
    return DealerResponse(
        id=dealer.id,
        name=dealer.name,
        phone=dealer.phone,
        district=dealer.district,
        village=dealer.village,
        taluk=dealer.taluk,
        location_lat=dealer.location_lat,
        location_lng=dealer.location_lng,
        address=dealer.address,
        contact_person=dealer.contact_person,
        alternate_contact=dealer.alternate_contact,
        state=dealer.state,
        pin_code=dealer.pin_code,
        gst_number=dealer.gst_number,
        dealer_type=dealer.dealer_type,
        remarks=dealer.remarks,
        assigned_sales_officer_id=dealer.assigned_sales_officer_id,
        status=dealer.status,
        requested_by=dealer.requested_by,
        created_at=dealer.created_at,
    )


async def _paid_amounts_by_order(session: AsyncSession, order_ids: list[uuid.UUID]) -> dict[uuid.UUID, float]:
    if not order_ids:
        return {}
    # Only rows with collection_status = 'collected' count toward amount
    # paid - the other statuses (extension_requested, dealer_unavailable,
    # etc from section 12) record a follow-up attempt, not money received.
    result = await session.execute(
        text(
            "SELECT dealer_order_id, COALESCE(SUM(amount), 0) AS paid FROM dealer_payments "
            "WHERE dealer_order_id = ANY(:order_ids) AND collection_status = 'collected' "
            "GROUP BY dealer_order_id"
        ).bindparams(order_ids=order_ids)
    )
    return {row.dealer_order_id: float(row.paid) for row in result.all()}


def _payment_status(total_amount: float, amount_paid: float, deadline) -> str:
    outstanding = round(total_amount - amount_paid, 2)
    if outstanding <= 0:
        return "paid"
    if not deadline:
        return "upcoming"
    today = date.today()
    if deadline < today:
        return "overdue"
    if deadline == today:
        return "due_today"
    return "upcoming"


def _to_order_response(order, amount_paid: float = 0.0) -> DealerOrderResponse:
    items = [
        {
            "id": item.id,
            "product_id": item.product_id,
            "quantity": item.quantity,
            "unit_price": item.unit_price,
        }
        for item in order.items
    ]
    outstanding = round(order.total_amount - amount_paid, 2)
    return DealerOrderResponse(
        id=order.id,
        dealer_id=order.dealer_id,
        created_by=order.created_by,
        status=order.status,
        total_amount=order.total_amount,
        comments=order.comments,
        payment_deadline=order.payment_deadline,
        payment_terms=order.payment_terms,
        amount_paid=amount_paid,
        outstanding_amount=max(0.0, outstanding),
        payment_status=_payment_status(order.total_amount, amount_paid, order.payment_deadline),
        order_date=order.order_date,
        items=items,
        created_at=order.created_at,
    )
