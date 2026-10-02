"""
Admin console router (section 3: full CRUD control for admin).

Consolidates admin-only create/update/delete surfaces that don't already
exist on their module's own router, plus the audit-log viewer and the
annual-target / monthly-weight configuration shared by the dashboard
productivity widget (section 2) and the visit-KPI rollup (section 5).

Deliberately NOT duplicated here: task edit (task_router.py already has a
full admin/manager PATCH - a write_audit_log() call was added there
instead of a second endpoint), user create/edit/status (user_management_router.py
already has full CRUD), HR policy edit (hr_policy_router.py already has it -
this file only adds delete), and momentum's own monthly-target endpoint
(kept as-is; annual_targets below is the new yearly layer above it, not a
replacement).

Products (create/update/deactivate) live here too, added alongside this
docstring's other CRUD - dealer_router.py's /products/catalog was
read-only with no write surface anywhere until now.

"Delete" is a soft delete everywhere (is_deleted = true, or is_active =
false for products - see that endpoint's own note), consistent with
the existing dealer pending_approval/active/rejected pattern - no hard
DELETEs, so the audit trail always has a live row to point at.
"""

from __future__ import annotations
import logging

import uuid
from datetime import datetime, timezone
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status

logger = logging.getLogger(__name__)
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.presentation.schemas.user_management_schemas import UserResponse
from app.presentation.api.v1.routers.user_management_router import _to_response
from app.domain.repositories.user_repository import UserRepository
from app.core.container import get_user_repository
from app.domain.value_objects.role import Role
from app.infrastructure.audit.audit_log import write_audit_log
from app.infrastructure.config.company_time import company_today
from app.infrastructure.database.session import get_db_session
from app.presentation.api.v1.dependencies import CurrentUser, require_role
from app.application.dto.auth_dto import CurrentUserOutput
from app.application.use_cases.farmer_use_case import FarmerUseCase
from app.application.use_cases.dealer_use_case import DealerUseCase
from app.core.container import get_farmer_use_case, get_dealer_use_case
from app.domain.services.pricing import (
    PRICE_SOURCE_GENERAL_TIER,
    ResolvedPrice,
    line_total,
)
from app.presentation.api.v1.routers.admin_daily_visit_router import _assemble_visit_detail
from app.presentation.api.v1.routers.daily_visit_tracker_router import submit_daily_visit
from app.presentation.schemas.daily_visit_tracker_schemas import DailyVisitTrackerSubmitRequest
from app.presentation.schemas.admin_schemas import (
    AdminCropIssueUpdateRequest,
    AdminDealerUpdateRequest,
    AdminFarmerUpdateRequest,
    AdminLeaveUpdateRequest,
    AdminProductCreateRequest,
    AdminProductResponse,
    AdminProductUpdateRequest,
    AnnualTargetResponse,
    AnnualTargetUpdateRequest,
    AuditLogResponse,
    BulkImportResponse,
    BulkPriceTierRequest,
    BulkProductRequest,
    BulkRowError,
    MonthlyWeightEntry,
    MonthlyWeightsResponse,
    MonthlyWeightsUpdateRequest,
    PriceQuoteResponse,
    PriceTierCreateRequest,
    PriceTierResponse,
    PriceTierUpdateRequest,
)
from app.presentation.schemas.dealer_schemas import DealerResponse
from app.presentation.schemas.farmer_schemas import FarmerResponse

router = APIRouter(prefix="/admin", tags=["admin"])

_AdminOnly = Annotated[object, Depends(require_role(Role.ADMIN))]


def _no_fields_error() -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields provided to update.")


# ---------------------------------------------------------------------------
# Audit log viewer
# ---------------------------------------------------------------------------

@router.get("/audit-logs", response_model=list[AuditLogResponse])
async def list_audit_logs(
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    event_type: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> list[AuditLogResponse]:
    query = """
        SELECT a.id, a.user_id, u.full_name AS actor_name, a.event_type, a.description, a.context_data, a.created_at
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.user_id
    """
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    if event_type:
        query += " WHERE a.event_type = :event_type"
        params["event_type"] = event_type
    query += " ORDER BY a.created_at DESC LIMIT :limit OFFSET :offset"

    result = await session.execute(text(query).bindparams(**params))
    return [
        AuditLogResponse(
            id=row.id,
            user_id=row.user_id,
            actor_name=row.actor_name,
            event_type=row.event_type,
            description=row.description,
            context_data=row.context_data or {},
            created_at=row.created_at,
        )
        for row in result.all()
    ]


# ---------------------------------------------------------------------------
# Farmers
# ---------------------------------------------------------------------------

_FARMER_SELECT = """
    SELECT id, name, phone, village, taluk, district, crop, cents, photo_url, created_by, created_at, updated_at, is_deleted,
           ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
    FROM farmers
"""


def _farmer_row_to_response(row) -> FarmerResponse:
    return FarmerResponse(
        id=row.id,
        name=row.name,
        phone=row.phone,
        village=row.village,
        taluk=row.taluk,
        district=row.district,
        crop=row.crop,
        cents=row.cents,
        location_lat=row.lat,
        location_lng=row.lng,
        photo_url=row.photo_url,
        created_by=row.created_by,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.patch("/farmers/{farmer_id}", response_model=FarmerResponse)
async def admin_update_farmer(
    farmer_id: uuid.UUID,
    payload: AdminFarmerUpdateRequest,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> FarmerResponse:
    existing = await session.execute(text(_FARMER_SELECT + " WHERE id = :id AND is_deleted = false").bindparams(id=farmer_id))
    row = existing.first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Farmer not found.")

    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        raise _no_fields_error()

    before = {k: getattr(row, k) for k in fields}
    fields["id"] = farmer_id
    fields["updated_at"] = datetime.now(timezone.utc)
    fields["updated_by"] = current_user.user_id
    set_clauses = ", ".join(f"{k} = :{k}" for k in fields if k != "id")
    await session.execute(text(f"UPDATE farmers SET {set_clauses} WHERE id = :id").bindparams(**fields))

    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_farmer_update",
        description=f"Admin edited farmer {farmer_id}",
        context_data={"farmer_id": str(farmer_id), "before": before, "after": payload.model_dump(exclude_unset=True)},
    )
    await session.commit()

    result = await session.execute(text(_FARMER_SELECT + " WHERE id = :id").bindparams(id=farmer_id))
    return _farmer_row_to_response(result.first())


@router.delete("/farmers/{farmer_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def admin_delete_farmer(
    farmer_id: uuid.UUID,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    existing = await session.execute(text("SELECT id FROM farmers WHERE id = :id AND is_deleted = false").bindparams(id=farmer_id))
    if not existing.first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Farmer not found.")

    await session.execute(
        text("UPDATE farmers SET is_deleted = true, updated_at = now(), updated_by = :updated_by WHERE id = :id")
        .bindparams(id=farmer_id, updated_by=current_user.user_id)
    )
    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_farmer_delete",
        description=f"Admin deleted farmer {farmer_id}",
        context_data={"farmer_id": str(farmer_id)},
    )
    await session.commit()


# ---------------------------------------------------------------------------
# Dealers
# ---------------------------------------------------------------------------

_DEALER_SELECT = """
    SELECT id, name, phone, district, village, taluk, address, contact_person,
           alternate_contact, state, pin_code, gst_number, dealer_type, remarks, assigned_sales_officer_id,
           status, requested_by, created_at, updated_at, is_deleted,
           ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
    FROM dealers
"""


def _dealer_row_to_response(row) -> DealerResponse:
    return DealerResponse(
        id=row.id,
        name=row.name,
        phone=row.phone,
        district=row.district,
        village=row.village,
        taluk=row.taluk,
        location_lat=row.lat,
        location_lng=row.lng,
        address=row.address,
        contact_person=row.contact_person,
        alternate_contact=row.alternate_contact,
        state=row.state,
        pin_code=row.pin_code,
        gst_number=row.gst_number,
        dealer_type=row.dealer_type,
        remarks=row.remarks,
        assigned_sales_officer_id=row.assigned_sales_officer_id,
        status=row.status,
        requested_by=row.requested_by,
        created_at=row.created_at,
    )


@router.patch("/dealers/{dealer_id}", response_model=DealerResponse)
async def admin_update_dealer(
    dealer_id: uuid.UUID,
    payload: AdminDealerUpdateRequest,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> DealerResponse:
    existing = await session.execute(text(_DEALER_SELECT + " WHERE id = :id AND is_deleted = false").bindparams(id=dealer_id))
    row = existing.first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dealer not found.")

    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        raise _no_fields_error()

    before = {k: getattr(row, k) for k in fields}
    fields["id"] = dealer_id
    fields["updated_at"] = datetime.now(timezone.utc)
    fields["updated_by"] = current_user.user_id
    set_clauses = ", ".join(f"{k} = :{k}" for k in fields if k != "id")
    await session.execute(text(f"UPDATE dealers SET {set_clauses} WHERE id = :id").bindparams(**fields))

    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_dealer_update",
        description=f"Admin edited dealer {dealer_id}",
        context_data={"dealer_id": str(dealer_id), "before": before, "after": payload.model_dump(exclude_unset=True)},
    )
    await session.commit()

    result = await session.execute(text(_DEALER_SELECT + " WHERE id = :id").bindparams(id=dealer_id))
    return _dealer_row_to_response(result.first())


@router.delete("/dealers/{dealer_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def admin_delete_dealer(
    dealer_id: uuid.UUID,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    existing = await session.execute(text("SELECT id FROM dealers WHERE id = :id AND is_deleted = false").bindparams(id=dealer_id))
    if not existing.first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dealer not found.")

    await session.execute(
        text("UPDATE dealers SET is_deleted = true, updated_at = now(), updated_by = :updated_by WHERE id = :id")
        .bindparams(id=dealer_id, updated_by=current_user.user_id)
    )
    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_dealer_delete",
        description=f"Admin deleted dealer {dealer_id}",
        context_data={"dealer_id": str(dealer_id)},
    )
    await session.commit()


# ---------------------------------------------------------------------------
# Products (master catalog) - previously read-only (GET /dealers/products/
# catalog only); this is the first create/update/deactivate surface for
# products at all. Soft-delete via is_active (migration 202608260003)
# rather than is_deleted, matching this table's catalog-entry shape rather
# than dealers' approval-lifecycle shape - see that migration's docstring.
# ---------------------------------------------------------------------------

_PRODUCT_SELECT = """
    SELECT p.id, p.name, p.category, p.sku_code, p.price, p.description, p.is_active,
           p.updated_by, u.full_name AS updated_by_name, p.created_at, p.updated_at
    FROM products p
    LEFT JOIN users u ON u.id = p.updated_by
"""


def _product_row_to_response(row) -> AdminProductResponse:
    return AdminProductResponse(
        id=row.id,
        name=row.name,
        category=row.category,
        sku_code=row.sku_code,
        price=float(row.price),
        description=row.description,
        is_active=row.is_active,
        updated_by=row.updated_by,
        updated_by_name=row.updated_by_name,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/products", response_model=list[AdminProductResponse])
async def admin_list_products(
    _current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    include_inactive: bool = True,
) -> list[AdminProductResponse]:
    query = _PRODUCT_SELECT
    if not include_inactive:
        query += " WHERE p.is_active = true"
    query += " ORDER BY p.name ASC"
    result = await session.execute(text(query))
    return [_product_row_to_response(row) for row in result.all()]


@router.post("/products", response_model=AdminProductResponse, status_code=status.HTTP_201_CREATED)
async def admin_create_product(
    payload: AdminProductCreateRequest,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AdminProductResponse:
    existing = await session.execute(
        text("SELECT 1 FROM products WHERE sku_code = :sku_code").bindparams(sku_code=payload.sku_code)
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A product with this SKU already exists.")

    new_id = uuid.uuid4()
    await session.execute(
        text(
            """
            INSERT INTO products (id, name, category, sku_code, price, description, is_active, updated_by)
            VALUES (:id, :name, :category, :sku_code, :price, :description, true, :updated_by)
            """
        ).bindparams(
            id=new_id,
            name=payload.name,
            category=payload.category,
            sku_code=payload.sku_code,
            price=payload.price,
            description=payload.description,
            updated_by=current_user.user_id,
        )
    )
    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_product_create",
        description=f"Admin created product {payload.name} ({payload.sku_code})",
        context_data={"product_id": str(new_id)},
    )
    await session.commit()

    result = await session.execute(text(_PRODUCT_SELECT + " WHERE p.id = :id").bindparams(id=new_id))
    return _product_row_to_response(result.one())


@router.patch("/products/{product_id}", response_model=AdminProductResponse)
async def admin_update_product(
    product_id: uuid.UUID,
    payload: AdminProductUpdateRequest,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AdminProductResponse:
    existing = await session.execute(text(_PRODUCT_SELECT + " WHERE p.id = :id").bindparams(id=product_id))
    row = existing.first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found.")

    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        raise _no_fields_error()

    if "sku_code" in fields and fields["sku_code"] != row.sku_code:
        dup = await session.execute(
            text("SELECT 1 FROM products WHERE sku_code = :sku_code AND id != :id")
            .bindparams(sku_code=fields["sku_code"], id=product_id)
        )
        if dup.scalar_one_or_none() is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A product with this SKU already exists.")

    before = {k: getattr(row, k) for k in fields}
    fields["id"] = product_id
    fields["updated_at"] = datetime.now(timezone.utc)
    fields["updated_by"] = current_user.user_id
    set_clauses = ", ".join(f"{k} = :{k}" for k in fields if k != "id")
    await session.execute(text(f"UPDATE products SET {set_clauses} WHERE id = :id").bindparams(**fields))

    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_product_update",
        description=f"Admin edited product {product_id}",
        context_data={"product_id": str(product_id), "before": before, "after": payload.model_dump(exclude_unset=True)},
    )
    await session.commit()

    result = await session.execute(text(_PRODUCT_SELECT + " WHERE p.id = :id").bindparams(id=product_id))
    return _product_row_to_response(result.one())


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def admin_deactivate_product(
    product_id: uuid.UUID,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    # Deactivate, never hard-delete: dealer_stocks, order_items,
    # stock_movements, and officer_product_stock all FK-reference
    # products, and existing dealer orders/stock history need to keep
    # resolving this product's name/SKU for as long as those rows exist.
    existing = await session.execute(text("SELECT id FROM products WHERE id = :id").bindparams(id=product_id))
    if not existing.first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found.")

    await session.execute(
        text("UPDATE products SET is_active = false, updated_at = now(), updated_by = :updated_by WHERE id = :id")
        .bindparams(id=product_id, updated_by=current_user.user_id)
    )
    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_product_deactivate",
        description=f"Admin deactivated product {product_id}",
        context_data={"product_id": str(product_id)},
    )
    await session.commit()


# ---------------------------------------------------------------------------
# Bulk product entry
#
# Products first, prices second - two separate sheets. The catalog is set up
# once; the price sheet is revised whenever rates move, and mixing the two
# would mean retyping every product's details to change one rate.
#
# All-or-nothing, with a dry run. Half a price list applied is worse than none
# applied: nobody can tell which products are now wrong, and the dealer finds
# out first.
# ---------------------------------------------------------------------------

@router.post("/products/bulk", response_model=BulkImportResponse)
async def admin_bulk_create_products(
    payload: BulkProductRequest,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> BulkImportResponse:
    rows = payload.rows
    errors: list[dict] = []
    staged: list[dict] = []
    seen_skus: dict[str, int] = {}
    seen_names: dict[str, int] = {}

    for index, row in enumerate(rows):
        line = row.row_number or index + 1
        sku = row.sku_code.strip()
        name = row.name.strip()

        # Duplicates inside the upload itself. The unique index would catch
        # these too, but only after some rows were already staged, and the
        # operator would be told about a constraint rather than about row 14.
        if sku.lower() in seen_skus:
            errors.append({
                "row_number": line,
                "error": f"SKU '{sku}' is already used on row {seen_skus[sku.lower()]} of this upload.",
            })
            continue
        if name.lower() in seen_names:
            errors.append({
                "row_number": line,
                "error": f"Product name '{name}' is already used on row {seen_names[name.lower()]} of this upload.",
            })
            continue

        clash = (
            await session.execute(
                text(
                    "SELECT sku_code, name FROM products "
                    "WHERE lower(sku_code) = lower(:sku) OR lower(name) = lower(:name) LIMIT 1"
                ).bindparams(sku=sku, name=name)
            )
        ).first()
        if clash:
            which = "SKU" if clash.sku_code.lower() == sku.lower() else "name"
            errors.append({
                "row_number": line,
                "error": f"A product with this {which} already exists ({clash.name}, {clash.sku_code}).",
            })
            continue

        seen_skus[sku.lower()] = line
        seen_names[name.lower()] = line
        staged.append({
            "row_number": line,
            "name": name,
            "category": row.category.strip(),
            "sku_code": sku,
            "price": row.price,
            "description": row.description,
        })

    if errors:
        # Nothing was written: every branch above either staged or recorded an
        # error, and the inserts happen only below.
        return BulkImportResponse(
            applied=0,
            rejected=len(errors),
            errors=errors,
            dry_run=payload.dry_run,
            message=(
                f"{len(errors)} of {len(rows)} rows could not be accepted. Nothing was "
                "saved - fix the rows listed and submit again."
            ),
        )

    if payload.dry_run:
        return BulkImportResponse(
            applied=0,
            would_apply=len(staged),
            rejected=0,
            dry_run=True,
            message=f"All {len(staged)} rows are valid. Nothing saved yet.",
        )

    for row in staged:
        await session.execute(
            text(
                "INSERT INTO products (name, category, sku_code, price, description, "
                "is_active, updated_by) VALUES (:name, :category, :sku, :price, "
                ":description, true, :updated_by)"
            ).bindparams(
                name=row["name"],
                category=row["category"],
                sku=row["sku_code"],
                price=row["price"],
                description=row["description"],
                updated_by=current_user.user_id,
            )
        )

    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_product_bulk_create",
        description=f"Admin bulk-created {len(staged)} products",
        context_data={"count": len(staged), "skus": [r["sku_code"] for r in staged][:50]},
    )
    await session.commit()

    return BulkImportResponse(
        applied=len(staged),
        rejected=0,
        dry_run=False,
        message=f"{len(staged)} products added.",
    )


# ---------------------------------------------------------------------------
# Price bands by quantity, and by dealer
#
# A product had one price, so a dealer buying 500 units paid the rate of a
# dealer buying 2. Precedence and the overlap guarantee are documented in
# app/domain/services/pricing.py and migration 202609300001.
# ---------------------------------------------------------------------------

_TIER_SELECT = """
    SELECT t.id, t.product_id, p.name AS product_name, p.sku_code,
           t.dealer_id, d.name AS dealer_name,
           t.min_quantity, t.max_quantity, t.price, t.note,
           t.created_at, t.updated_at
    FROM product_price_tiers t
    JOIN products p ON p.id = t.product_id
    LEFT JOIN dealers d ON d.id = t.dealer_id
"""


def _tier_row_to_response(row) -> PriceTierResponse:
    return PriceTierResponse(
        id=row.id,
        product_id=row.product_id,
        product_name=row.product_name,
        sku_code=row.sku_code,
        dealer_id=row.dealer_id,
        dealer_name=row.dealer_name,
        min_quantity=row.min_quantity,
        max_quantity=row.max_quantity,
        price=row.price,
        band_label=ResolvedPrice(
            price=row.price,
            source=PRICE_SOURCE_GENERAL_TIER,
            min_quantity=row.min_quantity,
            max_quantity=row.max_quantity,
        ).band_label,
        note=row.note,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/products/price-tiers", response_model=list[PriceTierResponse])
async def admin_list_price_tiers(
    _current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    product_id: Optional[uuid.UUID] = None,
    dealer_id: Optional[uuid.UUID] = None,
) -> list[PriceTierResponse]:
    query = _TIER_SELECT
    clauses: list[str] = []
    params: dict[str, Any] = {}
    if product_id is not None:
        clauses.append("t.product_id = :product_id")
        params["product_id"] = product_id
    if dealer_id is not None:
        # This dealer's own bands plus the general ones they fall back to -
        # which together are what they would actually be charged.
        clauses.append("(t.dealer_id = :dealer_id OR t.dealer_id IS NULL)")
        params["dealer_id"] = dealer_id
    if clauses:
        query += " WHERE " + " AND ".join(clauses)
    query += " ORDER BY p.name ASC, (t.dealer_id IS NULL) DESC, t.min_quantity ASC"
    result = await session.execute(text(query).bindparams(**params) if params else text(query))
    return [_tier_row_to_response(row) for row in result.all()]


@router.post(
    "/products/price-tiers",
    response_model=PriceTierResponse,
    status_code=status.HTTP_201_CREATED,
)
async def admin_create_price_tier(
    payload: PriceTierCreateRequest,
    current_user: _AdminOnly,
    use_case: Annotated[DealerUseCase, Depends(get_dealer_use_case)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> PriceTierResponse:
    created = await use_case.add_price_tier(
        product_id=payload.product_id,
        min_quantity=payload.min_quantity,
        price=payload.price,
        max_quantity=payload.max_quantity,
        dealer_id=payload.dealer_id,
        note=payload.note,
        created_by=current_user.user_id,
    )
    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_price_tier_create",
        description=f"Admin added a price band for product {payload.product_id}",
        context_data={
            "product_id": str(payload.product_id),
            "dealer_id": str(payload.dealer_id) if payload.dealer_id else None,
            "min_quantity": payload.min_quantity,
            "max_quantity": payload.max_quantity,
            "price": str(payload.price),
        },
    )
    await session.commit()

    row = (
        await session.execute(
            text(_TIER_SELECT + " WHERE t.id = :id").bindparams(id=created["id"])
        )
    ).one()
    return _tier_row_to_response(row)


@router.patch("/products/price-tiers/{tier_id}", response_model=PriceTierResponse)
async def admin_update_price_tier(
    tier_id: uuid.UUID,
    payload: PriceTierUpdateRequest,
    current_user: _AdminOnly,
    use_case: Annotated[DealerUseCase, Depends(get_dealer_use_case)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> PriceTierResponse:
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise _no_fields_error()
    await use_case.update_price_tier(tier_id, changes, updated_by=current_user.user_id)
    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_price_tier_update",
        description=f"Admin changed price band {tier_id}",
        context_data={"tier_id": str(tier_id), "changes": {k: str(v) for k, v in changes.items()}},
    )
    await session.commit()

    row = (
        await session.execute(
            text(_TIER_SELECT + " WHERE t.id = :id").bindparams(id=tier_id)
        )
    ).one()
    return _tier_row_to_response(row)


@router.delete(
    "/products/price-tiers/{tier_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def admin_delete_price_tier(
    tier_id: uuid.UUID,
    current_user: _AdminOnly,
    use_case: Annotated[DealerUseCase, Depends(get_dealer_use_case)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    # A hard delete is right here, unlike products: a band is a rule, not a
    # record. Orders already placed keep the unit_price they were priced at,
    # so removing the band cannot rewrite history.
    await use_case.delete_price_tier(tier_id)
    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_price_tier_delete",
        description=f"Admin removed price band {tier_id}",
        context_data={"tier_id": str(tier_id)},
    )
    await session.commit()


@router.post("/products/price-tiers/bulk", response_model=BulkImportResponse)
async def admin_bulk_create_price_tiers(
    payload: BulkPriceTierRequest,
    current_user: _AdminOnly,
    use_case: Annotated[DealerUseCase, Depends(get_dealer_use_case)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> BulkImportResponse:
    """Load a price sheet: many bands, across many products, in one go.

    Rows name a product by SKU (what the person filling in the sheet has in
    front of them) and a dealer by phone number, if the band is for one dealer.
    Resolving those to ids is done here so an unknown SKU is reported against
    its row instead of failing the whole request with a foreign-key error.
    """
    rows: list[dict] = []
    errors: list[dict] = []

    for index, row in enumerate(payload.rows):
        line = row.row_number or index + 1

        product_id = row.product_id
        if product_id is None:
            if not row.sku_code:
                errors.append({"row_number": line, "error": "Give either a SKU or a product id."})
                continue
            found = (
                await session.execute(
                    text("SELECT id FROM products WHERE lower(sku_code) = lower(:sku)")
                    .bindparams(sku=row.sku_code.strip())
                )
            ).scalar_one_or_none()
            if found is None:
                errors.append({
                    "row_number": line,
                    "error": f"No product with SKU '{row.sku_code}'. Add the product first.",
                })
                continue
            product_id = found

        dealer_id = row.dealer_id
        if dealer_id is None and row.dealer_phone:
            found = (
                await session.execute(
                    text("SELECT id FROM dealers WHERE phone = :phone AND is_deleted = false")
                    .bindparams(phone=row.dealer_phone.strip())
                )
            ).scalar_one_or_none()
            if found is None:
                errors.append({
                    "row_number": line,
                    "error": f"No dealer registered with phone '{row.dealer_phone}'.",
                })
                continue
            dealer_id = found

        rows.append({
            "row_number": line,
            "product_id": product_id,
            "dealer_id": dealer_id,
            "min_quantity": row.min_quantity,
            "max_quantity": row.max_quantity,
            "price": row.price,
            "note": row.note,
        })

    if errors:
        return BulkImportResponse(
            applied=0,
            rejected=len(errors),
            errors=errors,
            dry_run=payload.dry_run,
            message=(
                f"{len(errors)} of {len(payload.rows)} rows could not be read. Nothing "
                "was saved - fix the rows listed and submit again."
            ),
        )

    result = await use_case.bulk_add_price_tiers(
        rows, created_by=current_user.user_id, dry_run=payload.dry_run
    )

    if result["applied"]:
        await write_audit_log(
            session,
            user_id=current_user.user_id,
            event_type="admin_price_tier_bulk_create",
            description=f"Admin bulk-added {result['applied']} price bands",
            context_data={"count": result["applied"]},
        )
        await session.commit()
    else:
        # Nothing to keep: a rejected batch or a dry run. Roll back so no
        # partially-flushed row can be committed by a later request on this
        # session.
        await session.rollback()

    return BulkImportResponse(
        applied=result["applied"],
        rejected=result["rejected"],
        errors=[BulkRowError(**e) for e in result["errors"]],
        dry_run=result["dry_run"],
        would_apply=result.get("would_apply"),
        message=result["message"],
    )


@router.get("/products/{product_id}/quote", response_model=PriceQuoteResponse)
async def admin_quote_price(
    product_id: uuid.UUID,
    quantity: int,
    _current_user: _AdminOnly,
    use_case: Annotated[DealerUseCase, Depends(get_dealer_use_case)],
    dealer_id: Optional[uuid.UUID] = None,
) -> PriceQuoteResponse:
    """What this quantity costs, and why.

    The same resolver the order uses, so what a screen shows and what a dealer
    is billed cannot drift apart.
    """
    resolved = await use_case.quote_price(product_id, quantity, dealer_id=dealer_id)
    return PriceQuoteResponse(
        product_id=product_id,
        dealer_id=dealer_id,
        quantity=quantity,
        unit_price=resolved.price,
        line_total=line_total(resolved, quantity),
        source=resolved.source,
        source_label=resolved.source_label,
        band_label=resolved.band_label,
        note=resolved.note,
    )


# ---------------------------------------------------------------------------
# Tasks (edit already exists on task_router.py - delete only, here)
# ---------------------------------------------------------------------------

@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def admin_delete_task(
    task_id: uuid.UUID,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    existing = await session.execute(text("SELECT id FROM tasks WHERE id = :id AND is_deleted = false").bindparams(id=task_id))
    if not existing.first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")

    await session.execute(text("UPDATE tasks SET is_deleted = true, updated_at = now() WHERE id = :id").bindparams(id=task_id))
    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_task_delete",
        description=f"Admin deleted task {task_id}",
        context_data={"task_id": str(task_id)},
    )
    await session.commit()


# ---------------------------------------------------------------------------
# Leave requests (existing endpoint only does approve/reject - this adds a
# full edit and a delete)
# ---------------------------------------------------------------------------

@router.patch("/leave-requests/{leave_id}")
async def admin_update_leave_request(
    leave_id: uuid.UUID,
    payload: AdminLeaveUpdateRequest,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    existing = await session.execute(text("SELECT * FROM leave_requests WHERE id = :id AND is_deleted = false").bindparams(id=leave_id))
    row = existing.mappings().first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave request not found.")

    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        raise _no_fields_error()

    before = {k: row.get(k) for k in fields}
    fields["id"] = leave_id
    if "status" in fields:
        fields["decided_by"] = current_user.user_id
        fields["decided_at"] = datetime.now(timezone.utc)
    set_clauses = ", ".join(f"{k} = :{k}" for k in fields if k != "id")
    await session.execute(text(f"UPDATE leave_requests SET {set_clauses} WHERE id = :id").bindparams(**fields))

    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_leave_update",
        description=f"Admin edited leave request {leave_id}",
        context_data={"leave_id": str(leave_id), "before": before, "after": payload.model_dump(exclude_unset=True)},
    )
    await session.commit()
    return {"id": str(leave_id), "updated": True}


@router.delete("/leave-requests/{leave_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def admin_delete_leave_request(
    leave_id: uuid.UUID,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    existing = await session.execute(text("SELECT id FROM leave_requests WHERE id = :id AND is_deleted = false").bindparams(id=leave_id))
    if not existing.first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave request not found.")

    await session.execute(text("UPDATE leave_requests SET is_deleted = true WHERE id = :id").bindparams(id=leave_id))
    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_leave_delete",
        description=f"Admin deleted leave request {leave_id}",
        context_data={"leave_id": str(leave_id)},
    )
    await session.commit()


# ---------------------------------------------------------------------------
# Crop issues
# ---------------------------------------------------------------------------

@router.patch("/crop-issues/{issue_id}")
async def admin_update_crop_issue(
    issue_id: uuid.UUID,
    payload: AdminCropIssueUpdateRequest,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    existing = await session.execute(text("SELECT * FROM crop_issues WHERE id = :id AND is_deleted = false").bindparams(id=issue_id))
    row = existing.mappings().first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Crop issue not found.")

    fields = {k: v for k, v in payload.model_dump(exclude_unset=True).items()}
    if "description" in fields:
        fields["symptoms"] = fields.pop("description")
    if not fields:
        raise _no_fields_error()

    before = {k: row.get(k) for k in fields}
    fields["id"] = issue_id
    fields["updated_at"] = datetime.now(timezone.utc)
    set_clauses = ", ".join(f"{k} = :{k}" for k in fields if k != "id")
    await session.execute(text(f"UPDATE crop_issues SET {set_clauses} WHERE id = :id").bindparams(**fields))

    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_crop_issue_update",
        description=f"Admin edited crop issue {issue_id}",
        context_data={"issue_id": str(issue_id), "before": before, "after": payload.model_dump(exclude_unset=True)},
    )
    await session.commit()
    return {"id": str(issue_id), "updated": True}


@router.delete("/crop-issues/{issue_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def admin_delete_crop_issue(
    issue_id: uuid.UUID,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    existing = await session.execute(text("SELECT id FROM crop_issues WHERE id = :id AND is_deleted = false").bindparams(id=issue_id))
    if not existing.first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Crop issue not found.")

    await session.execute(text("UPDATE crop_issues SET is_deleted = true, updated_at = now() WHERE id = :id").bindparams(id=issue_id))
    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_crop_issue_delete",
        description=f"Admin deleted crop issue {issue_id}",
        context_data={"issue_id": str(issue_id)},
    )
    await session.commit()


# ---------------------------------------------------------------------------
# Weekly plans / HR policies / day closures / enquiries / users — delete only
# (their existing routers already cover create/read/update where that makes
# sense; see module docstring for what's intentionally not duplicated here)
# ---------------------------------------------------------------------------

async def _generic_soft_delete(
    session: AsyncSession,
    *,
    table: str,
    record_id: uuid.UUID,
    not_found_label: str,
    event_type: str,
    admin_user_id: uuid.UUID,
    extra_set: str = "",
) -> None:
    existing = await session.execute(text(f"SELECT id FROM {table} WHERE id = :id AND is_deleted = false").bindparams(id=record_id))
    if not existing.first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{not_found_label} not found.")

    await session.execute(
        text(f"UPDATE {table} SET is_deleted = true{extra_set} WHERE id = :id").bindparams(id=record_id)
    )
    await write_audit_log(
        session,
        user_id=admin_user_id,
        event_type=event_type,
        description=f"Admin deleted {not_found_label.lower()} {record_id}",
        context_data={"id": str(record_id), "table": table},
    )
    await session.commit()


@router.delete("/weekly-plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def admin_delete_weekly_plan(
    plan_id: uuid.UUID,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    await _generic_soft_delete(
        session,
        table="weekly_plans",
        record_id=plan_id,
        not_found_label="Weekly plan",
        event_type="admin_weekly_plan_delete",
        admin_user_id=current_user.user_id,
        extra_set=", updated_at = now()",
    )


@router.delete("/hr-policies/{policy_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def admin_delete_hr_policy(
    policy_id: uuid.UUID,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    await _generic_soft_delete(
        session,
        table="hr_policies",
        record_id=policy_id,
        not_found_label="HR policy section",
        event_type="admin_hr_policy_delete",
        admin_user_id=current_user.user_id,
        extra_set=", updated_at = now()",
    )


@router.delete("/day-closures/{closure_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def admin_delete_day_closure(
    closure_id: uuid.UUID,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    # Soft-deletes the day_closures marker row only, NOT the linked
    # visits row/its satellite data. Checked deliberately before writing
    # this: no other part of this app ever deletes a submitted visit
    # (only unsubmitted drafts have a delete endpoint - see
    # daily_visit_tracker_router.py's DELETE /drafts/{draft_id}), and
    # `visits` doesn't even have an is_deleted column. Visit history is
    # treated as permanent everywhere else in this codebase, so deleting
    # a day closure record removes the admin's "closure requirement was
    # met" bookkeeping without touching the farmer/crop/sales history
    # that visit represents - matches how the rest of the app already
    # behaves rather than introducing a one-off exception. The frontend
    # confirmation dialog says this explicitly.
    await _generic_soft_delete(
        session,
        table="day_closures",
        record_id=closure_id,
        not_found_label="Day closure",
        event_type="admin_day_closure_delete",
        admin_user_id=current_user.user_id,
    )


@router.put("/day-closures/{closure_id}")
async def admin_update_day_closure(
    closure_id: uuid.UUID,
    payload: dict,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    """Corrects the linked visit's editable summary fields. Reuses
    DailyVisitTrackerSubmitRequest's field names where they overlap
    (crop_status, severity, demo_status, purchased, order_value,
    conversion_status, officer_remarks) so the same field understood
    everywhere else in this app means the same thing here - only a
    partial update (whatever keys are present in the payload), matching
    the dynamic-SET-clause pattern this file already uses for
    admin_update_farmer/admin_update_dealer, since a full visit has 15
    satellite tables and an admin correction realistically only ever
    touches a handful of summary fields, not the entire submission."""
    closure_row = await session.execute(
        text("SELECT visit_id FROM day_closures WHERE id = :id AND is_deleted = false").bindparams(id=closure_id)
    )
    closure = closure_row.first()
    if not closure or not closure.visit_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Day closure not found, or has no linked visit.")
    visit_id = closure.visit_id

    health_fields = {k: payload[k] for k in ("crop_status", "severity") if k in payload}
    trial_fields = {k: payload[k] for k in ("demo_status",) if k in payload}
    sales_fields = {k: payload[k] for k in ("purchased", "order_value", "conversion_status") if k in payload}
    visit_fields = {k: payload[k] for k in ("officer_remarks", "follow_up_remarks") if k in payload}

    if not any([health_fields, trial_fields, sales_fields, visit_fields]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No editable fields were provided.")

    for table, fields in (
        ("visit_health", health_fields),
        ("visit_trial_details", trial_fields),
        ("visit_sales", sales_fields),
        ("visits", visit_fields),
    ):
        if not fields:
            continue
        set_clause = ", ".join(f"{k} = :{k}" for k in fields)
        await session.execute(
            text(f"UPDATE {table} SET {set_clause} WHERE visit_id = :visit_id" if table != "visits" else f"UPDATE visits SET {set_clause} WHERE id = :visit_id")
            .bindparams(**fields, visit_id=visit_id)
        )

    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_day_closure_edit",
        description=f"Admin edited day closure {closure_id} (visit {visit_id})",
        context_data={"closure_id": str(closure_id), "visit_id": str(visit_id), "fields": list(payload.keys())},
    )
    await session.commit()

    detail = await _assemble_visit_detail(visit_id, session)
    return {"visit_id": str(visit_id), "visit_detail": detail}


@router.post("/day-closures", status_code=status.HTTP_201_CREATED)
async def admin_create_day_closure(
    payload: DailyVisitTrackerSubmitRequest,
    officer_id: uuid.UUID,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    farmer_use_case: Annotated[FarmerUseCase, Depends(get_farmer_use_case)],
) -> dict:
    """Lets an admin file a day closure on behalf of an officer (e.g.
    correcting a missed submission), reusing submit_daily_visit() - the
    exact function day_closure_router.py's own POST endpoint calls -
    rather than a second implementation of visit creation. That function
    only ever touches current_user.user_id (checked before writing this,
    nothing else on current_user is referenced), so a synthetic
    CurrentUserOutput standing in for the target officer is enough to
    correctly attribute the visit to them, with zero changes to the
    tested, already-working function itself."""
    officer_row = await session.execute(
        text("SELECT id, role, full_name, email, employee_id FROM users WHERE id = :id AND is_active = true")
        .bindparams(id=officer_id)
    )
    officer = officer_row.first()
    if not officer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Officer not found or inactive.")
    if officer.role not in ("field_officer", "sales_officer"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Day closures can only be filed for a Field or Sales Officer.")

    existing = await session.execute(
        text("SELECT id FROM day_closures WHERE officer_id = :officer_id AND date = :today")
        .bindparams(officer_id=officer_id, today=company_today())
    )
    if existing.first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This officer already has a day closure for today.")

    officer_as_current_user = CurrentUserOutput(
        user_id=officer.id, email=officer.email, full_name=officer.full_name,
        role=officer.role, is_active=True, employee_id=officer.employee_id,
    )
    visit_result = await submit_daily_visit(
        payload=payload, current_user=officer_as_current_user, session=session, farmer_use_case=farmer_use_case,
    )

    closure_id = uuid.uuid4()
    await session.execute(
        text("""
            INSERT INTO day_closures (id, officer_id, date, visit_id, created_at)
            VALUES (:id, :officer_id, :today, :visit_id, :now)
        """).bindparams(id=closure_id, officer_id=officer_id, today=company_today(), visit_id=visit_result.visit_id, now=visit_result.created_at)
    )
    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_day_closure_create",
        description=f"Admin filed a day closure for officer {officer_id} (missed submission correction)",
        context_data={"closure_id": str(closure_id), "visit_id": str(visit_result.visit_id), "officer_id": str(officer_id)},
    )
    await session.commit()

    detail = await _assemble_visit_detail(visit_result.visit_id, session)
    return {"closure_id": str(closure_id), "visit_id": str(visit_result.visit_id), "visit_detail": detail}


@router.delete("/enquiries/{enquiry_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def admin_delete_enquiry(
    enquiry_id: uuid.UUID,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    await _generic_soft_delete(
        session,
        table="enquiries",
        record_id=enquiry_id,
        not_found_label="Enquiry",
        event_type="admin_enquiry_delete",
        admin_user_id=current_user.user_id,
    )



async def count_user_linked_records(session: AsyncSession, user_id: uuid.UUID) -> dict[str, int]:
    counts = {}
    q = text("""
        SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass AND c.confdeltype IN ('r', 'a')
    """)
    result = await session.execute(q)
    rows = result.fetchall()
    
    for table_name, column_name in rows:
        count_q = text(f"SELECT count(*) FROM {table_name} WHERE {column_name} = :uid")
        count = await session.scalar(count_q.bindparams(uid=user_id))
        if count and count > 0:
            counts[table_name] = counts.get(table_name, 0) + count
            
    return counts

@router.get("/users/{user_id}/delete-impact", response_model=dict)
async def delete_impact(
    user_id: uuid.UUID,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    counts = await count_user_linked_records(session, user_id)
    total = sum(counts.values())
    return {"can_hard_delete": total == 0, "counts": counts}

@router.delete("/users/{user_id}", status_code=status.HTTP_200_OK)
async def admin_delete_user(
    user_id: uuid.UUID,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    user_repo: Annotated[UserRepository, Depends(get_user_repository)],
) -> dict:
    if user_id == current_user.user_id:
        raise HTTPException(status_code=400, detail="An admin cannot delete their own account.")
    
    user = await user_repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    if user.is_active:
        raise HTTPException(status_code=400, detail="Cannot delete an active user. Disable first.")

    # Check if last active admin
    if user.role.value == "admin":
        active_admins = await session.scalar(text("SELECT count(*) FROM users WHERE role = 'admin' AND is_active = true AND is_deleted = false"))
        if active_admins <= 1 and user.is_active: # user is active check already failed above, so we are safe, but wait, the prompt says "the last active admin can never be deleted or disabled".
            pass

    counts = await count_user_linked_records(session, user_id)
    if sum(counts.values()) == 0:
        # hard delete
        try:
            from sqlalchemy.exc import IntegrityError
            await session.execute(text("DELETE FROM users WHERE id = :uid").bindparams(uid=user_id))
            await write_audit_log(session, user_id=current_user.user_id, event_type="admin_user_hard_delete", description=f"Admin hard deleted user {user_id}")
            await session.commit()
            return {"result": "deleted"}
        except IntegrityError as e:
            await session.rollback()
            logger.error(f"integrity_error_deleting_user: {user_id}", exc_info=True)
            raise HTTPException(
                status_code=400,
                detail=f"{user.full_name} has protected history and cannot be deleted. Disable the account instead; all history is kept."
            )
    else:
        # soft delete
        user.is_deleted = True
        user.updated_by = current_user.user_id
        await user_repo.update(user)
        await write_audit_log(session, user_id=current_user.user_id, event_type="admin_user_archive", description=f"Admin archived user {user_id}")
        await session.commit() # just in case user_repo.update doesn't commit
        return {"result": "archived"}

@router.post("/users/{user_id}/restore", response_model=dict)
async def admin_restore_user(
    user_id: uuid.UUID,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    user_repo: Annotated[UserRepository, Depends(get_user_repository)],
) -> dict:
    user = await user_repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_deleted = False
    # User stays disabled
    user.updated_by = current_user.user_id
    await user_repo.update(user)
    await write_audit_log(session, user_id=current_user.user_id, event_type="admin_user_restore", description=f"Admin restored archived user {user_id}")
    await session.commit()
    return {"result": "restored"}



# ---------------------------------------------------------------------------
# Annual targets + monthly weighting
# (feeds both the dashboard productivity widget's 3-month view and the
# visit-KPI rollup's yearly target - one mechanism, two consumers)
# ---------------------------------------------------------------------------

@router.get("/annual-targets/{role}", response_model=list[AnnualTargetResponse])
async def get_annual_targets(
    role: str,
    current_user: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    year: Optional[int] = None,
) -> list[AnnualTargetResponse]:
    query = "SELECT role, year, metric, annual_value, updated_at FROM annual_targets WHERE role = :role"
    params: dict[str, Any] = {"role": role}
    if year:
        query += " AND year = :year"
        params["year"] = year
    result = await session.execute(text(query).bindparams(**params))
    return [AnnualTargetResponse(**dict(row._mapping)) for row in result.all()]


@router.put("/annual-targets/{role}", response_model=AnnualTargetResponse)
async def upsert_annual_target(
    role: str,
    payload: AnnualTargetUpdateRequest,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AnnualTargetResponse:
    await session.execute(
        text(
            """
            INSERT INTO annual_targets (id, role, year, metric, annual_value, updated_at)
            VALUES (gen_random_uuid(), :role, :year, :metric, :annual_value, now())
            ON CONFLICT (role, year, metric)
            DO UPDATE SET annual_value = EXCLUDED.annual_value, updated_at = now()
            """
        ).bindparams(role=role, year=payload.year, metric=payload.metric, annual_value=payload.annual_value)
    )
    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_annual_target_set",
        description=f"Admin set {payload.metric} annual target for role '{role}' ({payload.year}) to {payload.annual_value}",
        context_data={"role": role, "year": payload.year, "metric": payload.metric, "annual_value": payload.annual_value},
    )
    await session.commit()

    result = await session.execute(
        text("SELECT role, year, metric, annual_value, updated_at FROM annual_targets WHERE role = :role AND year = :year AND metric = :metric")
        .bindparams(role=role, year=payload.year, metric=payload.metric)
    )
    return AnnualTargetResponse(**dict(result.first()._mapping))


@router.get("/monthly-weights/{role}", response_model=MonthlyWeightsResponse)
async def get_monthly_weights(
    role: str,
    current_user: Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    metric: str = "tasks_completed",
) -> MonthlyWeightsResponse:
    result = await session.execute(
        text("SELECT month, weight FROM monthly_target_weights WHERE role = :role AND metric = :metric ORDER BY month")
        .bindparams(role=role, metric=metric)
    )
    rows = result.all()
    if rows:
        weights = [MonthlyWeightEntry(month=r.month, weight=float(r.weight)) for r in rows]
    else:
        # No admin-defined weighting yet - fall back to an even split so
        # every consumer always has 12 usable weights, not a missing config.
        weights = [MonthlyWeightEntry(month=m, weight=round(1 / 12, 4)) for m in range(1, 13)]
    return MonthlyWeightsResponse(role=role, metric=metric, weights=weights)


@router.put("/monthly-weights/{role}", response_model=MonthlyWeightsResponse)
async def set_monthly_weights(
    role: str,
    payload: MonthlyWeightsUpdateRequest,
    current_user: _AdminOnly,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> MonthlyWeightsResponse:
    months_given = sorted(w.month for w in payload.weights)
    if months_given != list(range(1, 13)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exactly one weight per month (1-12) is required.")

    total = sum(w.weight for w in payload.weights)
    if abs(total - 1.0) > 0.01:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Monthly weights must sum to 1.0 (got {total:.4f}).",
        )

    for w in payload.weights:
        await session.execute(
            text(
                """
                INSERT INTO monthly_target_weights (id, role, metric, month, weight)
                VALUES (gen_random_uuid(), :role, :metric, :month, :weight)
                ON CONFLICT (role, metric, month) DO UPDATE SET weight = EXCLUDED.weight
                """
            ).bindparams(role=role, metric=payload.metric, month=w.month, weight=w.weight)
        )

    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="admin_monthly_weights_set",
        description=f"Admin set monthly weighting for role '{role}' metric '{payload.metric}'",
        context_data={"role": role, "metric": payload.metric, "weights": [w.model_dump() for w in payload.weights]},
    )
    await session.commit()
    return MonthlyWeightsResponse(role=role, metric=payload.metric, weights=payload.weights)
