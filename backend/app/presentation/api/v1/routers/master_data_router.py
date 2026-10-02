"""
Master data router - Daily Visit Tracker (Phase C, first endpoint set).

Read-only lookups backing the mobile wizard's dropdowns (crop category,
crop, variety, pest, disease, chemical, micronutrient, farm operation,
organic solution) and, later, the admin filter panel's option lists.
Every table here is seeded with named starter data - farm_operations and
organic_solutions in migration 202608250001, pests/diseases/chemicals in
202608260002 (which shipped empty in 202608250001 and were a known gap
until then) - but each is a real table an admin can extend; the mobile
form must never hard-code these lists itself, per section 35 of the spec.

Admin CRUD on these tables (add a new crop, deactivate a pest, etc.) is
intentionally NOT in this file - these are simple, identically-shaped
name+is_active tables, so one generic admin CRUD helper covering all 8
belongs together as its own follow-up piece, not duplicated 8 times here
ahead of when it's actually needed.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.value_objects.role import Role
from app.infrastructure.audit.audit_log import write_audit_log
from app.infrastructure.database.session import get_db_session
from app.presentation.api.v1.dependencies import CurrentUser, require_role

router = APIRouter(prefix="/master-data", tags=["master-data"])


class MasterDataItem(BaseModel):
    id: uuid.UUID
    name: str


class CropItem(BaseModel):
    id: uuid.UUID
    name: str
    crop_category_id: uuid.UUID


class VarietyItem(BaseModel):
    id: uuid.UUID
    name: str
    crop_id: uuid.UUID


async def _simple_list(session: AsyncSession, table: str) -> list[MasterDataItem]:
    result = await session.execute(
        text(f"SELECT id, name FROM {table} WHERE is_active = true ORDER BY name ASC")
    )
    return [MasterDataItem(id=row.id, name=row.name) for row in result.all()]


@router.get("/crop-categories", response_model=list[MasterDataItem])
async def list_crop_categories(current_user: CurrentUser, session: Annotated[AsyncSession, Depends(get_db_session)]):
    return await _simple_list(session, "crop_categories")


@router.get("/crops", response_model=list[CropItem])
async def list_crops(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    crop_category_id: Optional[uuid.UUID] = None,
):
    query = "SELECT id, name, crop_category_id FROM crops WHERE is_active = true"
    params = {}
    if crop_category_id:
        query += " AND crop_category_id = :cat_id"
        params["cat_id"] = crop_category_id
    query += " ORDER BY name ASC"
    result = await session.execute(text(query).bindparams(**params))
    return [CropItem(id=r.id, name=r.name, crop_category_id=r.crop_category_id) for r in result.all()]


@router.get("/crop-varieties", response_model=list[VarietyItem])
async def list_crop_varieties(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    crop_id: uuid.UUID,
):
    result = await session.execute(
        text("SELECT id, name, crop_id FROM crop_varieties WHERE is_active = true AND crop_id = :crop_id ORDER BY name ASC")
        .bindparams(crop_id=crop_id)
    )
    return [VarietyItem(id=r.id, name=r.name, crop_id=r.crop_id) for r in result.all()]


@router.get("/pests", response_model=list[MasterDataItem])
async def list_pests(current_user: CurrentUser, session: Annotated[AsyncSession, Depends(get_db_session)]):
    return await _simple_list(session, "pests")


@router.get("/diseases", response_model=list[MasterDataItem])
async def list_diseases(current_user: CurrentUser, session: Annotated[AsyncSession, Depends(get_db_session)]):
    return await _simple_list(session, "diseases")


@router.get("/chemicals", response_model=list[MasterDataItem])
async def list_chemicals(current_user: CurrentUser, session: Annotated[AsyncSession, Depends(get_db_session)]):
    return await _simple_list(session, "chemicals")


@router.get("/micronutrients", response_model=list[MasterDataItem])
async def list_micronutrients(current_user: CurrentUser, session: Annotated[AsyncSession, Depends(get_db_session)]):
    return await _simple_list(session, "micronutrients")


@router.get("/farm-operations", response_model=list[MasterDataItem])
async def list_farm_operations(current_user: CurrentUser, session: Annotated[AsyncSession, Depends(get_db_session)]):
    return await _simple_list(session, "farm_operations")


@router.get("/organic-solutions", response_model=list[MasterDataItem])
async def list_organic_solutions(current_user: CurrentUser, session: Annotated[AsyncSession, Depends(get_db_session)]):
    return await _simple_list(session, "organic_solutions")


# ---------------------------------------------------------------------------
# Admin CRUD (section 35) - one generic implementation covering all 9
# tables above, since they're all shaped the same way (id, name,
# is_active[, one optional parent FK for crops/crop_varieties]). Kept in
# this file rather than admin_router.py since it's the same domain as the
# read endpoints just above, not the general "admin console" grab-bag.
#
# "Delete" is a soft deactivate (is_active = false), never a real row
# delete - these are FK targets from potentially many visit_health_pests /
# visit_micronutrients / etc rows, and admin_router.py already established
# is_deleted/is_active soft-delete as this codebase's consistent pattern
# for exactly this reason (a hard delete would either fail on the FK or
# silently orphan historical visit data, neither acceptable).
# ---------------------------------------------------------------------------

class _TableConfig:
    def __init__(self, table: str, parent_col: Optional[str] = None):
        self.table = table
        self.parent_col = parent_col


_MASTER_DATA_TABLES: dict[str, _TableConfig] = {
    "crop-categories": _TableConfig("crop_categories"),
    "crops": _TableConfig("crops", parent_col="crop_category_id"),
    "crop-varieties": _TableConfig("crop_varieties", parent_col="crop_id"),
    "pests": _TableConfig("pests"),
    "diseases": _TableConfig("diseases"),
    "chemicals": _TableConfig("chemicals"),
    "micronutrients": _TableConfig("micronutrients"),
    "farm-operations": _TableConfig("farm_operations"),
    "organic-solutions": _TableConfig("organic_solutions"),
}


class MasterDataCreateRequest(BaseModel):
    name: str
    parent_id: Optional[uuid.UUID] = None  # crop_category_id (for crops) or crop_id (for crop-varieties); ignored otherwise
    is_active: bool = True


class MasterDataUpdateRequest(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[uuid.UUID] = None
    is_active: Optional[bool] = None


class MasterDataAdminItem(BaseModel):
    id: uuid.UUID
    name: str
    is_active: bool
    parent_id: Optional[uuid.UUID] = None


def _resolve_table(data_type: str) -> _TableConfig:
    config = _MASTER_DATA_TABLES.get(data_type)
    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown master data type '{data_type}'. Valid types: {', '.join(_MASTER_DATA_TABLES)}",
        )
    return config


@router.get("/{data_type}/admin", response_model=list[MasterDataAdminItem])
async def admin_list_master_data(
    data_type: str,
    current_user: Annotated[object, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[MasterDataAdminItem]:
    # Unlike the plain read endpoints above (which only ever return
    # is_active=true rows for dropdowns), this includes inactive ones too
    # - an admin managing the list needs to see what they've turned off,
    # not just what's currently selectable.
    config = _resolve_table(data_type)
    parent_col_sql = f", {config.parent_col} AS parent_id" if config.parent_col else ", NULL AS parent_id"
    result = await session.execute(text(f"SELECT id, name, is_active{parent_col_sql} FROM {config.table} ORDER BY name ASC"))
    return [MasterDataAdminItem(id=r.id, name=r.name, is_active=r.is_active, parent_id=r.parent_id) for r in result.all()]


@router.post("/{data_type}", response_model=MasterDataAdminItem, status_code=status.HTTP_201_CREATED)
async def create_master_data_item(
    data_type: str,
    payload: MasterDataCreateRequest,
    current_user: Annotated[object, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> MasterDataAdminItem:
    config = _resolve_table(data_type)
    if config.parent_col and not payload.parent_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"'{data_type}' requires parent_id.")

    new_id = uuid.uuid4()
    if config.parent_col:
        await session.execute(
            text(f"INSERT INTO {config.table} (id, name, is_active, {config.parent_col}) VALUES (:id, :name, :active, :parent)")
            .bindparams(id=new_id, name=payload.name, active=payload.is_active, parent=payload.parent_id)
        )
    else:
        await session.execute(
            text(f"INSERT INTO {config.table} (id, name, is_active) VALUES (:id, :name, :active)")
            .bindparams(id=new_id, name=payload.name, active=payload.is_active)
        )
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_master_data_create",
        description=f"Admin added '{payload.name}' to {data_type}",
        context_data={"data_type": data_type, "id": str(new_id), "name": payload.name},
    )
    await session.commit()
    return MasterDataAdminItem(id=new_id, name=payload.name, is_active=payload.is_active, parent_id=payload.parent_id)


@router.patch("/{data_type}/{item_id}", response_model=MasterDataAdminItem)
async def update_master_data_item(
    data_type: str,
    item_id: uuid.UUID,
    payload: MasterDataUpdateRequest,
    current_user: Annotated[object, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> MasterDataAdminItem:
    config = _resolve_table(data_type)
    parent_col_sql = f", {config.parent_col} AS parent_id" if config.parent_col else ", NULL AS parent_id"
    existing = await session.execute(text(f"SELECT id, name, is_active{parent_col_sql} FROM {config.table} WHERE id = :id").bindparams(id=item_id))
    row = existing.first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found.")

    fields = payload.model_dump(exclude_unset=True)
    if "parent_id" in fields:
        if not config.parent_col:
            fields.pop("parent_id")
        else:
            fields[config.parent_col] = fields.pop("parent_id")
    if not fields:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields provided to update.")

    before = {"name": row.name, "is_active": row.is_active, "parent_id": row.parent_id}
    set_clauses = ", ".join(f"{k} = :{k}" for k in fields)
    fields["id"] = item_id
    await session.execute(text(f"UPDATE {config.table} SET {set_clauses} WHERE id = :id").bindparams(**fields))

    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_master_data_update",
        description=f"Admin edited {data_type} item {item_id}",
        context_data={"data_type": data_type, "id": str(item_id), "before": before, "after": payload.model_dump(exclude_unset=True, mode="json")},
    )
    await session.commit()

    result = await session.execute(text(f"SELECT id, name, is_active{parent_col_sql} FROM {config.table} WHERE id = :id").bindparams(id=item_id))
    updated = result.first()
    return MasterDataAdminItem(id=updated.id, name=updated.name, is_active=updated.is_active, parent_id=updated.parent_id)


@router.delete("/{data_type}/{item_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def deactivate_master_data_item(
    data_type: str,
    item_id: uuid.UUID,
    current_user: Annotated[object, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    config = _resolve_table(data_type)
    existing = await session.execute(text(f"SELECT id FROM {config.table} WHERE id = :id").bindparams(id=item_id))
    if not existing.first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found.")

    await session.execute(text(f"UPDATE {config.table} SET is_active = false WHERE id = :id").bindparams(id=item_id))
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_master_data_delete",
        description=f"Admin deactivated {data_type} item {item_id}",
        context_data={"data_type": data_type, "id": str(item_id)},
    )
    await session.commit()
