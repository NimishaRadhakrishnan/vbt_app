"""
Stock router - one ledger, one answer.

Replaces `trial_router.py` (deleted) and `sales_stock_router.py`
(deleted). Those two computed "how much stock does this officer have?"
from the same table by two different formulas that disagreed the moment
a trial was given.

The single rule here: **current stock is always SUM(qty_delta)**. It is
never stored, so there is no second number that can drift from it. Every
endpoint below either reads that sum or appends a row to it.

`record_movement` is the only write path, and it is deliberately
importable: daily_visit_tracker_router calls it inside the visit's own
transaction so that a trial and its deduction commit together or not at
all.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.value_objects.role import Role
from app.infrastructure.audit.audit_log import write_audit_log
from app.infrastructure.database.session import get_db_session

from app.core.container import get_notification_repository
from app.domain.repositories.notification_repository import NotificationRepository
from app.domain.entities.notification import Notification

from app.presentation.api.v1.dependencies import CurrentUser, require_role

router = APIRouter(prefix="/stock", tags=["stock"])


# Movements an officer may record for themselves. `allocation` is absent
# on purpose: an officer must not be able to grant themselves stock, or
# the ledger stops being evidence of anything. Admin issues stock.
OFFICER_MOVEMENTS = {"sale", "damage", "return_to_company", "count_correction"}

NEGATIVE_MOVEMENTS = {
    "trial_given",
    "sale",
    "damage",
    "transfer_out",
    "return_to_company",
}


# ---------------------------------------------------------------------------
# Core helpers - importable, used inside other routers' transactions
# ---------------------------------------------------------------------------


async def get_balance(
    session: AsyncSession, officer_id: uuid.UUID, product_id: uuid.UUID
) -> Decimal:
    """Current stock = the sum of the ledger. No cached value exists."""
    result = await session.execute(
        text(
            """
            SELECT COALESCE(SUM(qty_delta), 0) AS balance
            FROM stock_ledger
            WHERE officer_id = :officer_id AND product_id = :product_id
            """
        ).bindparams(officer_id=officer_id, product_id=product_id)
    )
    return Decimal(str(result.scalar_one()))


async def record_movement(
    session: AsyncSession,
    *,
    officer_id: uuid.UUID,
    product_id: uuid.UUID,
    quantity: Decimal | float,
    movement_type: str,
    created_by: uuid.UUID,
    unit: str | None = None,
    ref_type: str | None = None,
    ref_id: uuid.UUID | None = None,
    remarks: str | None = None,
    allow_negative_balance: bool = False,
) -> Decimal:
    """Appends one ledger row and returns the new balance.

    `quantity` is given as a POSITIVE magnitude; the sign is derived from
    `movement_type` here rather than being the caller's responsibility.
    Callers passing their own sign is how a "give away 5" eventually
    becomes a "+5", and the database's sign constraint would reject it -
    but only after the caller had already got the semantics wrong.
    Deriving it centrally means there is one place to get it right.

    Does NOT commit. The caller owns the transaction, which is the whole
    point for the trial path: the visit and its stock deduction must be
    one commit.
    """
    magnitude = Decimal(str(quantity))
    if magnitude <= 0 and movement_type != "count_correction":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Quantity must be greater than zero.",
        )

    delta = -magnitude if movement_type in NEGATIVE_MOVEMENTS else magnitude

    if not allow_negative_balance and delta < 0:
        current = await get_balance(session, officer_id, product_id)
        if current + delta < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Only {current} left of this product. "
                    "Reduce the quantity, or ask admin to allocate more stock."
                ),
            )

    await session.execute(
        text(
            """
            INSERT INTO stock_ledger
                (id, officer_id, product_id, qty_delta, unit, movement_type,
                 ref_type, ref_id, remarks, created_by, created_at)
            VALUES
                (gen_random_uuid(), :officer_id, :product_id, :qty_delta, :unit,
                 :movement_type, :ref_type, :ref_id, :remarks, :created_by, :now)
            """
        ).bindparams(
            officer_id=officer_id,
            product_id=product_id,
            qty_delta=delta,
            unit=unit,
            movement_type=movement_type,
            ref_type=ref_type,
            ref_id=ref_id,
            remarks=remarks,
            created_by=created_by,
            now=datetime.now(UTC),
        )
    )
    return await get_balance(session, officer_id, product_id)


async def reverse_movements_for_ref(
    session: AsyncSession,
    *,
    ref_type: str,
    ref_id: uuid.UUID,
    created_by: uuid.UUID,
    remarks: str = "Reversal",
) -> int:
    """Writes compensating rows for every movement tied to a reference.

    Used when a visit is deleted or its trial quantities are edited.
    Compensating rows rather than DELETEs: an officer disputing their
    stock is owed a history of what happened, not a history with the
    inconvenient parts removed.
    """
    rows = await session.execute(
        text(
            """
            SELECT officer_id, product_id, qty_delta, unit
            FROM stock_ledger
            WHERE ref_type = :ref_type AND ref_id = :ref_id
              AND movement_type <> 'count_correction'
            """
        ).bindparams(ref_type=ref_type, ref_id=ref_id)
    )
    count = 0
    for row in rows.all():
        # A reversal is booked as count_correction because it is the only
        # movement type without a sign constraint - it can go either way,
        # which is exactly what reversing an arbitrary movement needs.
        await session.execute(
            text(
                """
                INSERT INTO stock_ledger
                    (id, officer_id, product_id, qty_delta, unit, movement_type,
                     ref_type, ref_id, remarks, created_by, created_at)
                VALUES
                    (gen_random_uuid(), :officer_id, :product_id, :qty_delta, :unit,
                     'count_correction', :ref_type, :ref_id, :remarks, :created_by, :now)
                """
            ).bindparams(
                officer_id=row.officer_id,
                product_id=row.product_id,
                qty_delta=-row.qty_delta,
                unit=row.unit,
                ref_type=ref_type,
                ref_id=ref_id,
                remarks=remarks,
                created_by=created_by,
                now=datetime.now(UTC),
            )
        )
        count += 1
    return count


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class StockItem(BaseModel):
    product_id: uuid.UUID
    product_name: str
    sku_code: str
    current_quantity: float
    unit: str | None = None
    last_movement_at: datetime | None = None


class MovementInput(BaseModel):
    product_id: uuid.UUID
    quantity: float = Field(gt=0)
    movement_type: str
    unit: str | None = None
    remarks: str | None = None


class RecordMovementsRequest(BaseModel):
    movements: list[MovementInput] = Field(min_length=1)


class MovementResult(BaseModel):
    product_id: uuid.UUID
    movement_type: str
    quantity: float
    new_balance: float


class LedgerEntry(BaseModel):
    id: uuid.UUID
    product_id: uuid.UUID
    product_name: str
    officer_name: str
    qty_delta: float
    movement_type: str
    ref_type: str | None = None
    ref_id: uuid.UUID | None = None
    remarks: str | None = None
    created_at: datetime


class AllocationInput(BaseModel):
    officer_id: uuid.UUID
    product_id: uuid.UUID
    quantity: float = Field(gt=0)
    unit: str | None = None
    remarks: str | None = None



class StockRequestInput(BaseModel):
    product_id: uuid.UUID
    quantity: float = Field(gt=0)


class BulkAllocationRequest(BaseModel):
    allocations: list[AllocationInput] = Field(min_length=1)


class ReconciliationRow(BaseModel):
    officer_id: uuid.UUID
    officer_name: str
    product_id: uuid.UUID
    product_name: str
    allocated: float
    trial_given: float
    sold: float
    other: float
    on_hand: float


# ---------------------------------------------------------------------------
# Officer endpoints
# ---------------------------------------------------------------------------


@router.get("/my-stock", response_model=list[StockItem])
async def get_my_stock(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[StockItem]:
    """Every catalogue product with this officer's balance.

    LEFT JOIN from products so a product the officer has never held shows
    as 0 rather than being absent. An absent product looks like a missing
    product; a zero looks like a missing allocation, which is what it
    actually is.
    """
    result = await session.execute(
        text(
            """
            SELECT p.id AS product_id, p.name AS product_name, p.sku_code,
                   COALESCE(SUM(sl.qty_delta), 0) AS current_quantity,
                   MAX(sl.unit) AS unit,
                   MAX(sl.created_at) AS last_movement_at
            FROM products p
            LEFT JOIN stock_ledger sl
                   ON sl.product_id = p.id AND sl.officer_id = :officer_id
            WHERE p.is_active
            GROUP BY p.id, p.name, p.sku_code
            ORDER BY p.name ASC
            """
        ).bindparams(officer_id=current_user.user_id)
    )
    return [
        StockItem(
            product_id=r.product_id,
            product_name=r.product_name,
            sku_code=r.sku_code,
            current_quantity=float(r.current_quantity),
            unit=r.unit,
            last_movement_at=r.last_movement_at,
        )
        for r in result.all()
    ]


@router.post("/movements", response_model=list[MovementResult])
async def record_movements(
    payload: RecordMovementsRequest,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[MovementResult]:
    """Officer records what happened to their stock.

    Note what this endpoint does NOT accept: a new balance. Officers
    record movements, never totals. "Set my stock to 40" throws away the
    reason it changed, which is the only part anyone needs during a
    dispute. A physical recount is a `count_correction` with a mandatory
    remark.

    One transaction for the whole batch: either every movement lands or
    none do. A half-applied batch would leave a balance nobody intended.
    """
    for m in payload.movements:
        if m.movement_type not in OFFICER_MOVEMENTS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"'{m.movement_type}' is not something you can record yourself.",
            )
        if m.movement_type == "count_correction" and not m.remarks:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Please say why the count is different.",
            )

    results: list[MovementResult] = []
    for m in payload.movements:
        # count_correction sets an absolute figure, so it is expressed as
        # the delta needed to reach it. Everything else is a magnitude.
        if m.movement_type == "count_correction":
            current = await get_balance(session, current_user.user_id, m.product_id)
            delta = Decimal(str(m.quantity)) - current
            if delta == 0:
                results.append(
                    MovementResult(
                        product_id=m.product_id,
                        movement_type=m.movement_type,
                        quantity=m.quantity,
                        new_balance=float(current),
                    )
                )
                continue
            await session.execute(
                text(
                    """
                    INSERT INTO stock_ledger
                        (id, officer_id, product_id, qty_delta, unit, movement_type,
                         remarks, created_by, created_at)
                    VALUES
                        (gen_random_uuid(), :officer_id, :product_id, :delta, :unit,
                         'count_correction', :remarks, :created_by, :now)
                    """
                ).bindparams(
                    officer_id=current_user.user_id,
                    product_id=m.product_id,
                    delta=delta,
                    unit=m.unit,
                    remarks=m.remarks,
                    created_by=current_user.user_id,
                    now=datetime.now(UTC),
                )
            )
            new_balance = await get_balance(session, current_user.user_id, m.product_id)
        else:
            new_balance = await record_movement(
                session,
                officer_id=current_user.user_id,
                product_id=m.product_id,
                quantity=m.quantity,
                movement_type=m.movement_type,
                created_by=current_user.user_id,
                unit=m.unit,
                remarks=m.remarks,
            )

        results.append(
            MovementResult(
                product_id=m.product_id,
                movement_type=m.movement_type,
                quantity=m.quantity,
                new_balance=float(new_balance),
            )
        )

    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="officer_stock_movement_record",
        description=f"Recorded {len(payload.movements)} stock movement(s)",
        context_data={"movements": [m.model_dump(mode="json") for m in payload.movements]},
    )
    await session.commit()
    return results


@router.get("/ledger", response_model=list[LedgerEntry])
async def get_ledger(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    officer_id: uuid.UUID | None = None,
    product_id: uuid.UUID | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[LedgerEntry]:
    """Full movement history.

    An officer sees their own movements. An admin or manager sees a named
    officer's, or - with no officer_id - everyone's.

    That last case used to fall back to `current_user.user_id`, so an admin
    asking for the whole history was silently asking for their own. Admins
    hold no stock, so the answer was always an empty list: the Stock History
    screen, which calls this with no officer_id, was permanently blank and
    the movement audit trail could not be reached from the UI at all.
    """
    is_privileged = current_user.role in (Role.ADMIN.value, Role.MANAGER.value)
    target = officer_id if (officer_id and is_privileged) else (
        None if is_privileged else current_user.user_id
    )

    query = """
        SELECT sl.id, sl.product_id, p.name AS product_name, u.full_name AS officer_name,
               sl.qty_delta, sl.movement_type, sl.ref_type, sl.ref_id,
               sl.remarks, sl.created_at
        FROM stock_ledger sl
        JOIN products p ON p.id = sl.product_id
        JOIN users u ON u.id = sl.officer_id
        WHERE (CAST(:officer_id AS UUID) IS NULL OR sl.officer_id = CAST(:officer_id AS UUID))
    """
    params: dict = {
        "officer_id": str(target) if target else None,
        "limit": limit,
        "offset": offset,
    }
    if product_id:
        query += " AND sl.product_id = :product_id"
        params["product_id"] = product_id
    query += " ORDER BY sl.created_at DESC, sl.id DESC LIMIT :limit OFFSET :offset"

    result = await session.execute(text(query).bindparams(**params))
    return [
        LedgerEntry(
            id=r.id,
            product_id=r.product_id,
            product_name=r.product_name,
            officer_name=r.officer_name,
            qty_delta=float(r.qty_delta),
            movement_type=r.movement_type,
            ref_type=r.ref_type,
            ref_id=r.ref_id,
            remarks=r.remarks,
            created_at=r.created_at,
        )
        for r in result.all()
    ]


# ---------------------------------------------------------------------------
# Admin endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/allocations",
    response_model=list[MovementResult],
    status_code=status.HTTP_201_CREATED,
)
async def allocate_stock(
    payload: BulkAllocationRequest,
    current_user: Annotated[CurrentUser, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[MovementResult]:
    """Admin issues stock to officers. Accepts a batch, so the bulk
    upload path (officer x product x quantity) is the same endpoint.

    THIS IS THE ENDPOINT THAT DID NOT EXIST. Nothing in the old backend
    ever wrote opening_stock or received_stock, so every officer's
    remaining was zero and trials were blocked for everyone. Without
    this, the ledger is correct and empty, which helps nobody.
    """
    results: list[MovementResult] = []
    for a in payload.allocations:
        new_balance = await record_movement(
            session,
            officer_id=a.officer_id,
            product_id=a.product_id,
            quantity=a.quantity,
            movement_type="allocation",
            created_by=current_user.user_id,
            unit=a.unit,
            remarks=a.remarks,
        )
        results.append(
            MovementResult(
                product_id=a.product_id,
                movement_type="allocation",
                quantity=a.quantity,
                new_balance=float(new_balance),
            )
        )

    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_stock_allocate",
        description=f"Allocated stock in {len(payload.allocations)} line(s)",
        context_data={"allocations": [a.model_dump(mode="json") for a in payload.allocations]},
    )
    await session.commit()
    return results


@router.get("/reconciliation", response_model=list[ReconciliationRow])
async def get_reconciliation(
    _current_user: Annotated[CurrentUser, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    officer_id: uuid.UUID | None = None,
) -> list[ReconciliationRow]:
    """Allocated vs given vs sold vs on-hand, per officer per product.

    The point of this view is that `on_hand` is not an independent number
    to be checked against the others - it IS their sum. Anything
    surprising here is a real movement someone recorded, not a
    reconciliation error, and the ledger says who recorded it and when.
    """
    query = """
        SELECT sl.officer_id, u.full_name AS officer_name,
               sl.product_id, p.name AS product_name,
               COALESCE(SUM(sl.qty_delta)
                   FILTER (WHERE sl.movement_type IN ('allocation', 'transfer_in')),
                   0) AS allocated,
               COALESCE(-SUM(sl.qty_delta)
                   FILTER (WHERE sl.movement_type = 'trial_given'),
                   0) AS trial_given,
               COALESCE(-SUM(sl.qty_delta)
                   FILTER (WHERE sl.movement_type = 'sale'),
                   0) AS sold,
               COALESCE(SUM(sl.qty_delta)
                   FILTER (WHERE sl.movement_type IN ('damage', 'transfer_out',
                                                      'return_to_company',
                                                      'count_correction')),
                   0) AS other,
               COALESCE(SUM(sl.qty_delta), 0) AS on_hand
        FROM stock_ledger sl
        JOIN users u ON u.id = sl.officer_id
        JOIN products p ON p.id = sl.product_id
    """
    params: dict = {}
    if officer_id:
        query += " WHERE sl.officer_id = :officer_id"
        params["officer_id"] = officer_id
    query += """
        GROUP BY sl.officer_id, u.full_name, sl.product_id, p.name
        ORDER BY u.full_name ASC, p.name ASC
    """

    stmt = text(query)
    if params:
        stmt = stmt.bindparams(**params)
    result = await session.execute(stmt)
    return [
        ReconciliationRow(
            officer_id=r.officer_id,
            officer_name=r.officer_name,
            product_id=r.product_id,
            product_name=r.product_name,
            allocated=float(r.allocated),
            trial_given=float(r.trial_given),
            sold=float(r.sold),
            other=float(r.other),
            on_hand=float(r.on_hand),
        )
        for r in result.all()
    ]



@router.post("/request", status_code=status.HTTP_201_CREATED)
async def request_stock(
    payload: StockRequestInput,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    
):
    """Officer requests stock from their manager or admin."""

        
    
    from app.core.container import get_notification_repository
    notification_repo = get_notification_repository(session)

    product_name = "Unknown Product"
    res = await session.execute(text("SELECT name FROM products WHERE id = :pid").bindparams(pid=payload.product_id))
    if row := res.fetchone():
        product_name = row[0]
        
    # Find admins (or manager if we had one explicitly linked easily)
    admins = await session.execute(text("SELECT id FROM users WHERE role IN ('admin', 'manager') AND is_active = true"))
    admin_ids = [r[0] for r in admins.all()]
    
    for aid in admin_ids:
        n = Notification(
            user_id=aid,
            title="Stock Request",
            message=f"{current_user.full_name} requested {payload.quantity} of {product_name}.",
            type="stock_request"
        )
        await notification_repo.add(n)
        
    return {"status": "success", "notified_count": len(admin_ids)}
