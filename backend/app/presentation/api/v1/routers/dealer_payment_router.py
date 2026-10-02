"""
Dealer payment collection router (sections 9-15 of the Sales Officer spec).

Everything here reads/writes the append-only dealer_payments and
dealer_payment_deadline_history tables from migration 202608250003 -
outstanding is always computed (total_amount - SUM(collected payments)),
never stored, per section 7's explicit instruction, and no endpoint here
ever UPDATEs or DELETEs a dealer_payments row - only INSERT, matching
section 13/15's "never overwrite financial history" rule structurally,
not just as a convention someone could violate later.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from app.presentation.schemas.date_validators import validate_not_past
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.value_objects.role import Role
from app.infrastructure.audit.audit_log import write_audit_log
from app.infrastructure.database.session import get_db_session
from app.presentation.api.v1.dependencies import CurrentUser, require_role

router = APIRouter(prefix="/dealers/orders", tags=["dealer-payments"])


class RecordCollectionRequest(BaseModel):
    collection_status: str = Field(pattern="^(collected|extension_requested|dealer_unavailable|payment_promised|dispute|other)$")
    amount: float = Field(default=0, ge=0)
    payment_date: Optional[date] = None
    method: Optional[str] = None
    reference_number: Optional[str] = None
    receipt_image_url: Optional[str] = None
    remarks: Optional[str] = None


class PaymentHistoryItem(BaseModel):
    id: uuid.UUID
    amount: float
    payment_date: date
    method: Optional[str] = None
    reference_number: Optional[str] = None
    collection_status: str
    collected_by_name: str
    remarks: Optional[str] = None
    created_at: datetime


class CollectionRequiredItem(BaseModel):
    dealer_order_id: uuid.UUID
    dealer_id: uuid.UUID
    dealer_name: str
    total_amount: float
    amount_paid: float
    outstanding_amount: float
    payment_deadline: Optional[date] = None
    payment_status: str


async def _get_order_totals(session: AsyncSession, order_id: uuid.UUID):
    result = await session.execute(
        text(
            """
            SELECT ord_.id, ord_.dealer_id, ord_.total_amount, ord_.payment_deadline,
                   COALESCE((SELECT SUM(amount) FROM dealer_payments WHERE dealer_order_id = ord_.id AND collection_status = 'collected'), 0) AS amount_paid
            FROM dealer_orders ord_ WHERE ord_.id = :order_id
            """
        ).bindparams(order_id=order_id)
    )
    return result.first()


def _payment_status(total_amount: float, amount_paid: float, deadline) -> str:
    outstanding = round(float(total_amount) - float(amount_paid), 2)
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


@router.post("/{order_id}/payments", response_model=PaymentHistoryItem, status_code=status.HTTP_201_CREATED)
async def record_collection(
    order_id: uuid.UUID,
    payload: RecordCollectionRequest,
    current_user: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER, Role.SALES_OFFICER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> PaymentHistoryItem:
    order = await _get_order_totals(session, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found.")

    if payload.collection_status == "collected":
        outstanding = float(order.total_amount) - float(order.amount_paid)
        if payload.amount <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Collected amount must be greater than zero.")
        if payload.amount > outstanding + 0.01:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Collected amount cannot exceed the outstanding amount (₹{outstanding:.2f}).",
            )

    payment_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    amount_to_record = payload.amount if payload.collection_status == "collected" else 0
    await session.execute(
        text(
            """
            INSERT INTO dealer_payments (
                id, dealer_order_id, amount, payment_date, method, reference_number,
                receipt_image_url, collected_by, collection_status, remarks, created_at
            ) VALUES (
                :id, :order_id, :amount, :payment_date, :method, :reference_number,
                :receipt_image_url, :officer_id, :status, :remarks, :now
            )
            """
        ).bindparams(
            id=payment_id, order_id=order_id, amount=amount_to_record,
            payment_date=payload.payment_date or date.today(), method=payload.method,
            reference_number=payload.reference_number, receipt_image_url=payload.receipt_image_url,
            officer_id=current_user.user_id, status=payload.collection_status, remarks=payload.remarks, now=now,
        )
    )
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="dealer_payment_recorded",
        description=f"Recorded '{payload.collection_status}' on order {order_id}",
        context_data={"order_id": str(order_id), "collection_status": payload.collection_status, "amount": amount_to_record},
    )
    await session.commit()

    officer_name_row = await session.execute(text("SELECT full_name FROM users WHERE id = :id").bindparams(id=current_user.user_id))
    officer_name = officer_name_row.scalar() or "Unknown"

    return PaymentHistoryItem(
        id=payment_id, amount=amount_to_record, payment_date=payload.payment_date or date.today(),
        method=payload.method, reference_number=payload.reference_number, collection_status=payload.collection_status,
        collected_by_name=officer_name, remarks=payload.remarks, created_at=now,
    )


@router.get("/{order_id}/payments", response_model=list[PaymentHistoryItem])
async def get_payment_history(
    order_id: uuid.UUID,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[PaymentHistoryItem]:
    result = await session.execute(
        text(
            """
            SELECT dp.id, dp.amount, dp.payment_date, dp.method, dp.reference_number,
                   dp.collection_status, dp.remarks, dp.created_at, u.full_name AS collected_by_name
            FROM dealer_payments dp JOIN users u ON u.id = dp.collected_by
            WHERE dp.dealer_order_id = :order_id
            ORDER BY dp.created_at ASC
            """
        ).bindparams(order_id=order_id)
    )
    return [
        PaymentHistoryItem(
            id=row.id, amount=float(row.amount), payment_date=row.payment_date, method=row.method,
            reference_number=row.reference_number, collection_status=row.collection_status,
            collected_by_name=row.collected_by_name, remarks=row.remarks, created_at=row.created_at,
        )
        for row in result.all()
    ]


@router.get("/collections/required", response_model=list[CollectionRequiredItem])
async def list_collections_required(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    officer_id: Optional[uuid.UUID] = None,
    status_filter: Optional[str] = None,
) -> list[CollectionRequiredItem]:
    is_privileged = current_user.role in ("admin", "manager")
    target_officer = officer_id if (officer_id and is_privileged) else (None if is_privileged else current_user.user_id)

    query = """
        SELECT ord_.id AS order_id, ord_.dealer_id, d.name AS dealer_name, ord_.total_amount, ord_.payment_deadline,
               COALESCE((SELECT SUM(amount) FROM dealer_payments WHERE dealer_order_id = ord_.id AND collection_status = 'collected'), 0) AS amount_paid
        FROM dealer_orders ord_
        JOIN dealers d ON d.id = ord_.dealer_id
        WHERE ord_.status NOT IN ('draft', 'cancelled')
    """
    params: dict = {}
    if target_officer:
        query += " AND d.assigned_sales_officer_id = :officer_id"
        params["officer_id"] = target_officer

    result = await session.execute(text(query).bindparams(**params))
    items: list[CollectionRequiredItem] = []
    for row in result.all():
        outstanding = round(float(row.total_amount) - float(row.amount_paid), 2)
        if outstanding <= 0:
            continue
        p_status = _payment_status(row.total_amount, row.amount_paid, row.payment_deadline)
        if status_filter and p_status != status_filter:
            continue
        items.append(
            CollectionRequiredItem(
                dealer_order_id=row.order_id, dealer_id=row.dealer_id, dealer_name=row.dealer_name,
                total_amount=float(row.total_amount), amount_paid=float(row.amount_paid),
                outstanding_amount=outstanding, payment_deadline=row.payment_deadline, payment_status=p_status,
            )
        )
    priority = {"overdue": 0, "due_today": 1, "upcoming": 2}
    items.sort(key=lambda i: priority.get(i.payment_status, 3))
    return items


class DeadlineExtensionRequest(BaseModel):
    new_deadline: date
    reason: Optional[str] = None

    @field_validator("new_deadline", mode="after")
    @classmethod
    def check_deadline(cls, v):
        return validate_not_past(v)


class DeadlineExtensionResponse(BaseModel):
    id: uuid.UUID
    dealer_order_id: uuid.UUID
    old_deadline: Optional[date] = None
    new_deadline: date
    applied_immediately: bool


@router.post("/{order_id}/deadline-extension", response_model=DeadlineExtensionResponse, status_code=status.HTTP_201_CREATED)
async def request_deadline_extension(
    order_id: uuid.UUID,
    payload: DeadlineExtensionRequest,
    current_user: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER, Role.SALES_OFFICER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> DeadlineExtensionResponse:
    order_row = await session.execute(text("SELECT payment_deadline FROM dealer_orders WHERE id = :id").bindparams(id=order_id))
    order = order_row.first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found.")

    is_privileged = current_user.role in ("admin", "manager")
    history_id = uuid.uuid4()
    await session.execute(
        text(
            """
            INSERT INTO dealer_payment_deadline_history (id, dealer_order_id, old_deadline, new_deadline, reason, requested_by, approved_by, created_at)
            VALUES (:id, :order_id, :old, :new, :reason, :requested_by, :approved_by, now())
            """
        ).bindparams(
            id=history_id, order_id=order_id, old=order.payment_deadline, new=payload.new_deadline,
            reason=payload.reason, requested_by=current_user.user_id,
            approved_by=current_user.user_id if is_privileged else None,
        )
    )
    if is_privileged:
        await session.execute(
            text("UPDATE dealer_orders SET payment_deadline = :new WHERE id = :id").bindparams(new=payload.new_deadline, id=order_id)
        )
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="dealer_deadline_change",
        description=f"{'Changed' if is_privileged else 'Requested change of'} payment deadline for order {order_id}",
        context_data={"order_id": str(order_id), "old_deadline": str(order.payment_deadline), "new_deadline": str(payload.new_deadline), "applied": is_privileged},
    )
    await session.commit()

    return DeadlineExtensionResponse(
        id=history_id, dealer_order_id=order_id, old_deadline=order.payment_deadline,
        new_deadline=payload.new_deadline, applied_immediately=is_privileged,
    )


@router.patch("/deadline-extensions/{history_id}/approve", response_model=DeadlineExtensionResponse)
async def approve_deadline_extension(
    history_id: uuid.UUID,
    current_user: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> DeadlineExtensionResponse:
    row = await session.execute(
        text("SELECT dealer_order_id, old_deadline, new_deadline, approved_by FROM dealer_payment_deadline_history WHERE id = :id")
        .bindparams(id=history_id)
    )
    record = row.first()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Extension request not found.")
    if record.approved_by:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This request was already decided.")

    await session.execute(
        text("UPDATE dealer_payment_deadline_history SET approved_by = :approver WHERE id = :id")
        .bindparams(approver=current_user.user_id, id=history_id)
    )
    await session.execute(
        text("UPDATE dealer_orders SET payment_deadline = :new WHERE id = :id")
        .bindparams(new=record.new_deadline, id=record.dealer_order_id)
    )
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="dealer_deadline_extension_approved",
        description=f"Approved deadline extension for order {record.dealer_order_id}",
        context_data={"order_id": str(record.dealer_order_id), "new_deadline": str(record.new_deadline)},
    )
    await session.commit()

    return DeadlineExtensionResponse(
        id=history_id, dealer_order_id=record.dealer_order_id, old_deadline=record.old_deadline,
        new_deadline=record.new_deadline, applied_immediately=True,
    )
