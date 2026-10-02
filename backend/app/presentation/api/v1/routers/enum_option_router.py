"""
Enum Field Options router.

Manages the value sets for crop_status, demo_status, and farming_type -
previously hard database CHECK constraints, converted by migration
202608260010 to rows in enum_field_options so they can be safely
add/removed/deactivated without ever touching the schema again. See
that migration's docstring for why a live-migration-generation approach
(as originally requested) was not built - this is the safe replacement
that achieves the same admin-facing goal.

Every mutation here is ordinary transactional row CRUD - no DDL, no
generated code, no app-server filesystem writes. Deleting an option
first checks real usage (via _USAGE_LOOKUP below) and refuses if any
existing record uses it, offering deactivate as the safe alternative;
deactivating always works regardless of usage, since it only hides the
option from future forms without touching historical data.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.audit.audit_log import write_audit_log
from app.infrastructure.database.session import get_db_session
from app.presentation.api.v1.dependencies import CurrentUser, require_role
from app.domain.value_objects.role import Role
from app.application.dto.auth_dto import CurrentUserOutput
from app.presentation.schemas.enum_option_schemas import (
    EnumOptionResponse,
    EnumOptionCreateRequest,
    EnumOptionUpdateRequest,
    EnumOptionReorderRequest,
)

router = APIRouter(tags=["enum-options"])

# field_name -> (table, column) actually storing that value in a real
# submitted record - used to count usage before allowing a hard delete.
_USAGE_LOOKUP = {
    "crop_status": ("visit_health", "crop_status"),
    "demo_status": ("visit_trial_details", "demo_status"),
    "farming_type": ("visits", "farming_type"),
    # Sales Officer day closure (202608260017). Registered here so the
    # same admin options editor manages them - without this entry
    # _check_field_name would reject them as unmanaged and admins could
    # not add or retire a visit purpose without a migration.
    "sales_visit_purpose": ("sales_closure_details", "visit_purpose"),
    "sales_stock_status": ("sales_closure_details", "stock_status"),
}

_ALLOWED_FIELDS = set(_USAGE_LOOKUP.keys())


def _check_field_name(field_name: str) -> None:
    if field_name not in _ALLOWED_FIELDS:
        raise HTTPException(status_code=404, detail=f"'{field_name}' is not a managed option field.")


@router.get("/enum-options/{field_name}", response_model=list[EnumOptionResponse])
async def get_enum_options(
    field_name: str,
    _current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[EnumOptionResponse]:
    """What the officer-facing form actually renders its dropdown from -
    active options only, in order. Replaces the hardcoded arrays that
    used to live directly in DayClosureForm.tsx for these 3 fields."""
    _check_field_name(field_name)
    result = await session.execute(
        text("""
            SELECT id, field_name, value, label, display_order, is_active, requires_description, updated_at
            FROM enum_field_options WHERE field_name = :field_name AND is_active = true
            ORDER BY display_order
        """).bindparams(field_name=field_name)
    )
    return [EnumOptionResponse(**dict(row._mapping)) for row in result.all()]


@router.get("/admin/enum-options/{field_name}", response_model=list[EnumOptionResponse])
async def admin_list_enum_options(
    field_name: str,
    _current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[EnumOptionResponse]:
    """Every option including inactive ones, plus a live usage_count so
    the Builder can show "12 existing records use this value" without a
    separate round trip."""
    _check_field_name(field_name)
    table, column = _USAGE_LOOKUP[field_name]
    result = await session.execute(
        text(f"""
            SELECT o.id, o.field_name, o.value, o.label, o.display_order, o.is_active, o.requires_description, o.updated_at,
                   COALESCE(u.cnt, 0) AS usage_count
            FROM enum_field_options o
            LEFT JOIN (
                SELECT {column} AS value, COUNT(*) AS cnt FROM {table} WHERE {column} IS NOT NULL GROUP BY {column}
            ) u ON u.value = o.value
            WHERE o.field_name = :field_name
            ORDER BY o.display_order
        """).bindparams(field_name=field_name)
    )
    return [EnumOptionResponse(**dict(row._mapping)) for row in result.all()]


@router.post("/admin/enum-options/{field_name}", response_model=EnumOptionResponse, status_code=status.HTTP_201_CREATED)
async def admin_create_enum_option(
    field_name: str,
    payload: EnumOptionCreateRequest,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> EnumOptionResponse:
    _check_field_name(field_name)
    # Case-insensitive dedup - the database's own unique index
    # (uq_enum_field_options_field_value_ci) is the real guarantee under
    # concurrent requests; this check exists only to return a clear
    # message instead of a raw constraint-violation error.
    existing = await session.execute(
        text("SELECT 1 FROM enum_field_options WHERE field_name = :field_name AND lower(value) = lower(:value)")
        .bindparams(field_name=field_name, value=payload.value)
    )
    if existing.first():
        raise HTTPException(status_code=400, detail=f'"{payload.value}" already exists for this field (case-insensitive).')

    max_order = await session.execute(
        text("SELECT COALESCE(MAX(display_order), 0) AS m FROM enum_field_options WHERE field_name = :field_name")
        .bindparams(field_name=field_name)
    )
    next_order = (max_order.first().m or 0) + 10

    new_id = uuid.uuid4()
    try:
        await session.execute(
            text("""
                INSERT INTO enum_field_options (id, field_name, value, label, display_order, requires_description, updated_by)
                VALUES (:id, :field_name, :value, :label, :order, :reqdesc, :uid)
            """).bindparams(id=new_id, field_name=field_name, value=payload.value, label=payload.label, order=next_order, reqdesc=payload.requires_description, uid=current_user.user_id)
        )
    except Exception:
        await session.rollback()
        raise HTTPException(status_code=400, detail=f'"{payload.value}" already exists for this field.')

    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_enum_option_add",
        description=f"Admin added option '{payload.value}' to '{field_name}'",
        context_data={"field_name": field_name, "value": payload.value, "label": payload.label},
    )
    await session.commit()

    result = await session.execute(
        text("SELECT id, field_name, value, label, display_order, is_active, requires_description, updated_at FROM enum_field_options WHERE id = :id")
        .bindparams(id=new_id)
    )
    return EnumOptionResponse(**dict(result.first()._mapping))


@router.put("/admin/enum-options/{field_name}/reorder", response_model=list[EnumOptionResponse])
async def admin_reorder_enum_options(
    field_name: str,
    payload: EnumOptionReorderRequest,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[EnumOptionResponse]:
    _check_field_name(field_name)
    for item in payload.items:
        await session.execute(
            text("UPDATE enum_field_options SET display_order = :order, updated_by = :uid, updated_at = now() WHERE id = :id AND field_name = :field_name")
            .bindparams(order=item.display_order, uid=current_user.user_id, id=item.id, field_name=field_name)
        )
    await session.commit()
    result = await session.execute(
        text("SELECT id, field_name, value, label, display_order, is_active, requires_description, updated_at FROM enum_field_options WHERE field_name = :field_name ORDER BY display_order")
        .bindparams(field_name=field_name)
    )
    return [EnumOptionResponse(**dict(row._mapping)) for row in result.all()]


@router.put("/admin/enum-options/{field_name}/{option_id}", response_model=EnumOptionResponse)
async def admin_update_enum_option(
    field_name: str,
    option_id: uuid.UUID,
    payload: EnumOptionUpdateRequest,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> EnumOptionResponse:
    _check_field_name(field_name)
    existing = await session.execute(
        text("SELECT id FROM enum_field_options WHERE id = :id AND field_name = :field_name").bindparams(id=option_id, field_name=field_name)
    )
    if not existing.first():
        raise HTTPException(status_code=404, detail="Option not found.")

    if payload.label is not None:
        await session.execute(
            text("UPDATE enum_field_options SET label = :label, updated_by = :uid, updated_at = now() WHERE id = :id")
            .bindparams(label=payload.label, uid=current_user.user_id, id=option_id)
        )
        await write_audit_log(
            session, user_id=current_user.user_id, event_type="admin_enum_option_edit",
            description=f"Admin relabeled an option on '{field_name}'",
            context_data={"field_name": field_name, "option_id": str(option_id), "new_label": payload.label},
        )
        await session.commit()

    result = await session.execute(
        text("SELECT id, field_name, value, label, display_order, is_active, requires_description, updated_at FROM enum_field_options WHERE id = :id")
        .bindparams(id=option_id)
    )
    return EnumOptionResponse(**dict(result.first()._mapping))


@router.put("/admin/enum-options/{field_name}/{option_id}/deactivate", response_model=EnumOptionResponse)
async def admin_deactivate_enum_option(
    field_name: str,
    option_id: uuid.UUID,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> EnumOptionResponse:
    """Hides the option from future forms without touching historical
    records that already used it - the safe alternative offered
    whenever a hard delete is blocked by usage, and always available
    regardless of usage count."""
    _check_field_name(field_name)
    await _assert_not_last_active_option(session, field_name, option_id)

    await session.execute(
        text("UPDATE enum_field_options SET is_active = false, updated_by = :uid, updated_at = now() WHERE id = :id AND field_name = :field_name")
        .bindparams(uid=current_user.user_id, id=option_id, field_name=field_name)
    )
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_enum_option_deactivate",
        description=f"Admin deactivated an option on '{field_name}'",
        context_data={"field_name": field_name, "option_id": str(option_id)},
    )
    await session.commit()

    result = await session.execute(
        text("SELECT id, field_name, value, label, display_order, is_active, requires_description, updated_at FROM enum_field_options WHERE id = :id")
        .bindparams(id=option_id)
    )
    return EnumOptionResponse(**dict(result.first()._mapping))


@router.delete("/admin/enum-options/{field_name}/{option_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def admin_delete_enum_option(
    field_name: str,
    option_id: uuid.UUID,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    _check_field_name(field_name)
    row = await session.execute(
        text("SELECT value FROM enum_field_options WHERE id = :id AND field_name = :field_name").bindparams(id=option_id, field_name=field_name)
    )
    option = row.first()
    if not option:
        raise HTTPException(status_code=404, detail="Option not found.")

    table, column = _USAGE_LOOKUP[field_name]
    usage = await session.execute(
        text(f"SELECT COUNT(*) AS cnt FROM {table} WHERE {column} = :value").bindparams(value=option.value)
    )
    count = usage.first().cnt
    if count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot remove — {count} existing record{'s' if count != 1 else ''} use this value. Deactivate it instead to hide it from future forms without affecting existing data.",
        )

    await _assert_not_last_active_option(session, field_name, option_id)

    await session.execute(text("DELETE FROM enum_field_options WHERE id = :id").bindparams(id=option_id))
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_enum_option_delete",
        description=f"Admin deleted unused option '{option.value}' from '{field_name}'",
        context_data={"field_name": field_name, "value": option.value},
    )
    await session.commit()


async def _assert_not_last_active_option(session: AsyncSession, field_name: str, excluding_id: uuid.UUID) -> None:
    remaining = await session.execute(
        text("SELECT COUNT(*) AS cnt FROM enum_field_options WHERE field_name = :field_name AND is_active = true AND id != :id")
        .bindparams(field_name=field_name, id=excluding_id)
    )
    if remaining.first().cnt == 0:
        raise HTTPException(status_code=400, detail="Cannot remove the last remaining option for this field — at least one must stay active.")
