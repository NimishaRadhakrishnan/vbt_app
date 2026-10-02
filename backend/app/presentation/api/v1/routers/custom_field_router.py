"""
Custom Field router - generic, reusable across forms.

Confirmed decision: Admin can define genuinely new fields/sections with
no existing backend column. These save into custom_field_answers as
JSON, NOT into any form's real typed submission model - accepted
trade-off is that custom answers do not appear in exports, admin detail
views, or anything else reading from the real schema. See the
202608260009 migration's docstring for the full reasoning.

form_key identifies which form a definition/answer belongs to
("day_closure", "weekly_plan", "leave_request", "farmer_registration",
...) - one generic system, reused per form, rather than rebuilding this
per form. Only "day_closure" has actual UI wired to it so far; the data
model is ready for the others as they're extended to use it.
"""

from __future__ import annotations

import json
import re
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
from app.presentation.schemas.custom_field_schemas import (
    CustomFieldDefinitionResponse,
    CustomFieldCreateRequest,
    CustomFieldUpdateRequest,
    CustomFieldReorderRequest,
    CustomFieldAnswersSubmitRequest,
    CustomFieldAnswerResponse,
    CustomFieldConfigResponse,
)

async def _bump_config_version(session: AsyncSession, form_key: str) -> None:
    await session.execute(
        text("UPDATE form_config_versions SET version = version + 1, updated_at = now() WHERE form_key = :form_key")
        .bindparams(form_key=form_key)
    )

async def _get_config_version(session: AsyncSession, form_key: str) -> int:
    result = await session.execute(
        text("SELECT version FROM form_config_versions WHERE form_key = :form_key")
        .bindparams(form_key=form_key)
    )
    row = result.first()
    return row.version if row else 1

router = APIRouter(tags=["custom-fields"])

_SELECT_COLUMNS = (
    "id, form_key, field_key, section, label, placeholder, help_text, field_type, options, "
    "is_required, is_enabled, display_order, visible_to_field_officer, visible_to_sales_officer, "
    "visible_to_manager, default_value, updated_at"
)


def _row_to_response(row) -> CustomFieldDefinitionResponse:
    return CustomFieldDefinitionResponse(
        id=row.id, form_key=row.form_key, field_key=row.field_key, section=row.section,
        label=row.label, placeholder=row.placeholder, help_text=row.help_text, field_type=row.field_type,
        options=row.options, is_required=row.is_required, is_enabled=row.is_enabled,
        display_order=row.display_order, visible_to_field_officer=row.visible_to_field_officer,
        visible_to_sales_officer=row.visible_to_sales_officer, visible_to_manager=row.visible_to_manager,
        default_value=row.default_value, updated_at=row.updated_at,
    )


def _slugify(label: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")
    return slug or "field"


@router.get("/custom-fields/{form_key}", response_model=CustomFieldConfigResponse)
async def get_my_custom_fields(
    form_key: str,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> CustomFieldConfigResponse:
    """What an officer's form actually renders its custom fields from -
    enabled, visible to their role, in order. Mirrors
    day_closure_config_router.py's GET /day-closure-config exactly."""
    role_column = {
        "field_officer": "visible_to_field_officer",
        "sales_officer": "visible_to_sales_officer",
        "manager": "visible_to_manager",
    }.get(current_user.role)
    where_role = f"AND {role_column} = true" if role_column else ""
    result = await session.execute(
        text(f"""
            SELECT {_SELECT_COLUMNS} FROM custom_field_definitions
            WHERE form_key = :form_key AND is_enabled = true AND is_deleted = false {where_role}
            ORDER BY display_order
        """).bindparams(form_key=form_key)
    )
    version = await _get_config_version(session, form_key)
    return CustomFieldConfigResponse(
        version=version,
        fields=[_row_to_response(row) for row in result.all()]
    )


@router.post("/custom-fields/{form_key}/{record_id}/answers", status_code=status.HTTP_201_CREATED)
async def submit_custom_field_answers(
    form_key: str,
    record_id: uuid.UUID,
    payload: CustomFieldAnswersSubmitRequest,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    """Saves whatever custom answers came with a real submission
    (record_id is that submission's own id - a visit_id for
    day_closure, etc.). Called alongside the real submit endpoint, not
    instead of it - this never blocks or replaces the actual save."""
    for field_key, value in payload.answers.items():
        await session.execute(
            text("""
                INSERT INTO custom_field_answers (id, form_key, record_id, field_key, value, submitted_by)
                VALUES (gen_random_uuid(), :form_key, :record_id, :field_key, CAST(:value AS JSONB), :uid)
                ON CONFLICT (form_key, record_id, field_key) DO UPDATE SET value = EXCLUDED.value
            """).bindparams(form_key=form_key, record_id=record_id, field_key=field_key, value=json.dumps(value), uid=current_user.user_id)
        )
    await session.commit()
    return {"saved": len(payload.answers)}


@router.get("/custom-fields/{form_key}/{record_id}/answers", response_model=list[CustomFieldAnswerResponse])
async def get_custom_field_answers(
    form_key: str,
    record_id: uuid.UUID,
    _current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[CustomFieldAnswerResponse]:
    result = await session.execute(
        text("SELECT field_key, value FROM custom_field_answers WHERE form_key = :form_key AND record_id = :record_id")
        .bindparams(form_key=form_key, record_id=record_id)
    )
    return [CustomFieldAnswerResponse(field_key=row.field_key, value=row.value) for row in result.all()]


@router.get("/admin/custom-fields/{form_key}", response_model=CustomFieldConfigResponse)
async def admin_list_custom_fields(
    form_key: str,
    _current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> CustomFieldConfigResponse:
    result = await session.execute(
        text(f"SELECT {_SELECT_COLUMNS} FROM custom_field_definitions WHERE form_key = :form_key AND is_deleted = false ORDER BY display_order")
        .bindparams(form_key=form_key)
    )
    version = await _get_config_version(session, form_key)
    return CustomFieldConfigResponse(
        version=version,
        fields=[_row_to_response(row) for row in result.all()]
    )


@router.post("/admin/custom-fields/{form_key}", response_model=CustomFieldDefinitionResponse, status_code=status.HTTP_201_CREATED)
async def admin_create_custom_field(
    form_key: str,
    payload: CustomFieldCreateRequest,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> CustomFieldDefinitionResponse:
    base_key = _slugify(payload.label)
    field_key = base_key
    suffix = 1
    while True:
        existing = await session.execute(
            text("SELECT 1 FROM custom_field_definitions WHERE form_key = :form_key AND field_key = :field_key")
            .bindparams(form_key=form_key, field_key=field_key)
        )
        if not existing.first():
            break
        suffix += 1
        field_key = f"{base_key}_{suffix}"

    max_order = await session.execute(
        text("SELECT COALESCE(MAX(display_order), 0) AS m FROM custom_field_definitions WHERE form_key = :form_key")
        .bindparams(form_key=form_key)
    )
    next_order = (max_order.first().m or 0) + 10

    new_id = uuid.uuid4()
    options_json = json.dumps([o.model_dump() for o in payload.options]) if payload.options else None
    await session.execute(
        text("""
            INSERT INTO custom_field_definitions (
                id, form_key, field_key, section, label, placeholder, help_text, field_type, options,
                is_required, display_order, visible_to_field_officer, visible_to_sales_officer,
                visible_to_manager, default_value, created_by, updated_by
            ) VALUES (
                :id, :form_key, :field_key, :section, :label, :placeholder, :help_text, :field_type,
                CAST(:options AS JSONB), :is_required, :order, :vis_fo, :vis_so, :vis_mgr, :default_value, :uid, :uid
            )
        """).bindparams(
            id=new_id, form_key=form_key, field_key=field_key, section=payload.section, label=payload.label,
            placeholder=payload.placeholder, help_text=payload.help_text, field_type=payload.field_type,
            options=options_json, is_required=payload.is_required, order=next_order,
            vis_fo=payload.visible_to_field_officer, vis_so=payload.visible_to_sales_officer,
            vis_mgr=payload.visible_to_manager, default_value=payload.default_value, uid=current_user.user_id,
        )
    )
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_custom_field_create",
        description=f"Admin created custom field '{payload.label}' on form '{form_key}'",
        context_data={"form_key": form_key, "field_key": field_key},
    )
    await _bump_config_version(session, form_key)
    await session.commit()

    result = await session.execute(
        text(f"SELECT {_SELECT_COLUMNS} FROM custom_field_definitions WHERE id = :id").bindparams(id=new_id)
    )
    return _row_to_response(result.first())


@router.put("/admin/custom-fields/{form_key}/reorder", response_model=list[CustomFieldDefinitionResponse])
async def admin_reorder_custom_fields(
    form_key: str,
    payload: CustomFieldReorderRequest,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[CustomFieldDefinitionResponse]:
    for item in payload.items:
        await session.execute(
            text("UPDATE custom_field_definitions SET display_order = :order, updated_by = :uid, updated_at = now() WHERE form_key = :form_key AND field_key = :key")
            .bindparams(order=item.display_order, uid=current_user.user_id, form_key=form_key, key=item.field_key)
        )
    await _bump_config_version(session, form_key)
    await session.commit()
    result = await session.execute(
        text(f"SELECT {_SELECT_COLUMNS} FROM custom_field_definitions WHERE form_key = :form_key AND is_deleted = false ORDER BY display_order")
        .bindparams(form_key=form_key)
    )
    return [_row_to_response(row) for row in result.all()]


@router.put("/admin/custom-fields/{form_key}/{field_key}", response_model=CustomFieldDefinitionResponse)
async def admin_update_custom_field(
    form_key: str,
    field_key: str,
    payload: CustomFieldUpdateRequest,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> CustomFieldDefinitionResponse:
    existing = await session.execute(
        text("SELECT id FROM custom_field_definitions WHERE form_key = :form_key AND field_key = :field_key AND is_deleted = false")
        .bindparams(form_key=form_key, field_key=field_key)
    )
    if not existing.first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Custom field not found.")

    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields provided to update.")
    if "options" in fields:
        fields["options"] = json.dumps(fields["options"]) if fields["options"] is not None else None
        set_clause_parts = [f"{k} = CAST(:{k} AS JSONB)" if k == "options" else f"{k} = :{k}" for k in fields]
    else:
        set_clause_parts = [f"{k} = :{k}" for k in fields]
    set_clause = ", ".join(set_clause_parts)

    await session.execute(
        text(f"UPDATE custom_field_definitions SET {set_clause}, updated_by = :uid, updated_at = now() WHERE form_key = :form_key AND field_key = :field_key")
        .bindparams(**fields, uid=current_user.user_id, form_key=form_key, field_key=field_key)
    )
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_custom_field_edit",
        description=f"Admin edited custom field '{field_key}' on form '{form_key}'",
        context_data={"form_key": form_key, "field_key": field_key, "changes": list(fields.keys())},
    )
    await _bump_config_version(session, form_key)
    await session.commit()

    result = await session.execute(
        text(f"SELECT {_SELECT_COLUMNS} FROM custom_field_definitions WHERE form_key = :form_key AND field_key = :field_key")
        .bindparams(form_key=form_key, field_key=field_key)
    )
    return _row_to_response(result.first())


@router.delete("/admin/custom-fields/{form_key}/{field_key}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def admin_delete_custom_field(
    form_key: str,
    field_key: str,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    # Soft-delete only - existing custom_field_answers for this field
    # are left in place (a deleted field's past answers aren't erased,
    # matching how day_closure's own delete never touches historical
    # visit data either).
    existing = await session.execute(
        text("SELECT id FROM custom_field_definitions WHERE form_key = :form_key AND field_key = :field_key AND is_deleted = false")
        .bindparams(form_key=form_key, field_key=field_key)
    )
    if not existing.first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Custom field not found.")

    await session.execute(
        text("UPDATE custom_field_definitions SET is_deleted = true, updated_by = :uid, updated_at = now() WHERE form_key = :form_key AND field_key = :field_key")
        .bindparams(uid=current_user.user_id, form_key=form_key, field_key=field_key)
    )
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_custom_field_delete",
        description=f"Admin deleted custom field '{field_key}' on form '{form_key}'",
        context_data={"form_key": form_key, "field_key": field_key},
    )
    await _bump_config_version(session, form_key)
    await session.commit()
