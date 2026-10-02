"""
Day Closure Field Config router.

Backs the Admin "Page Builder" for the Day Closure / Daily Visit
Tracker form (frontend/components/DayClosureForm.tsx). See
202608260008's migration docstring for the full scope decision - this
configures the ~27 fields that already exist and already save correctly
through DailyVisitTrackerSubmitRequest, not admin-invented arbitrary
fields with nowhere in the schema to be stored.

Two consumers:
- GET /day-closure-config (any authenticated officer): the fields
  actually visible to them, enabled, in order - what
  DayClosureForm.tsx renders itself from.
- The /admin/day-closure-config/* endpoints below (admin-only): full
  CRUD for the Page Builder.
"""

from __future__ import annotations

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
from app.presentation.schemas.day_closure_config_schemas import (
    FieldConfigResponse,
    FieldConfigUpdateRequest,
    FieldConfigReorderRequest,
    SectionResponse,
    SectionCreateRequest,
    SectionUpdateRequest,
    SectionReorderRequest,
)

async def _bump_config_version(session: AsyncSession, form_key: str = "day_closure") -> None:
    await session.execute(
        text("UPDATE form_config_versions SET version = version + 1, updated_at = now() WHERE form_key = :form_key")
        .bindparams(form_key=form_key)
    )

router = APIRouter(tags=["day-closure-config"])

_SELECT_COLUMNS = (
    "id, field_key, section, label, placeholder, help_text, field_type, is_required, "
    "is_enabled, display_order, visible_to_field_officer, visible_to_sales_officer, "
    "default_value, backend_required, updated_at"
)


def _row_to_response(row) -> FieldConfigResponse:
    return FieldConfigResponse(
        id=row.id, field_key=row.field_key, section=row.section, label=row.label,
        placeholder=row.placeholder, help_text=row.help_text, field_type=row.field_type,
        is_required=row.is_required, is_enabled=row.is_enabled, display_order=row.display_order,
        visible_to_field_officer=row.visible_to_field_officer,
        visible_to_sales_officer=row.visible_to_sales_officer,
        default_value=row.default_value, backend_required=row.backend_required, updated_at=row.updated_at,
    )


@router.get("/day-closure-config", response_model=list[FieldConfigResponse])
async def get_my_day_closure_config(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[FieldConfigResponse]:
    """What DayClosureForm.tsx actually renders itself from - only
    enabled fields visible to this user's role, in display order. Admin/
    Manager see everything enabled (both role-visibility flags checked
    is redundant for them but harmless) so previewing/testing the form
    as either role stays possible without a separate preview mode."""
    role_column = "visible_to_field_officer" if current_user.role == "field_officer" else (
        "visible_to_sales_officer" if current_user.role == "sales_officer" else None
    )
    where_role = f"AND {role_column} = true" if role_column else ""
    result = await session.execute(
        text(f"SELECT {_SELECT_COLUMNS} FROM day_closure_field_configs WHERE is_enabled = true {where_role} ORDER BY display_order")
    )
    return [_row_to_response(row) for row in result.all()]


@router.get("/admin/day-closure-config", response_model=list[FieldConfigResponse])
async def admin_list_day_closure_config(
    _current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[FieldConfigResponse]:
    result = await session.execute(text(f"SELECT {_SELECT_COLUMNS} FROM day_closure_field_configs ORDER BY display_order"))
    return [_row_to_response(row) for row in result.all()]


@router.put("/admin/day-closure-config/reorder", response_model=list[FieldConfigResponse])
async def admin_reorder_day_closure_config(
    payload: FieldConfigReorderRequest,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[FieldConfigResponse]:
    for item in payload.items:
        await session.execute(
            text("UPDATE day_closure_field_configs SET display_order = :order, updated_by = :uid, updated_at = now() WHERE field_key = :key")
            .bindparams(order=item.display_order, uid=current_user.user_id, key=item.field_key)
        )
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_day_closure_config_reorder",
        description="Admin reordered Day Closure form fields",
        context_data={"order": [{"field_key": i.field_key, "display_order": i.display_order} for i in payload.items]},
    )
    await _bump_config_version(session)
    await session.commit()
    result = await session.execute(text(f"SELECT {_SELECT_COLUMNS} FROM day_closure_field_configs ORDER BY display_order"))
    return [_row_to_response(row) for row in result.all()]


@router.post("/admin/day-closure-config/restore-defaults", response_model=list[FieldConfigResponse])
async def admin_restore_day_closure_defaults(
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[FieldConfigResponse]:
    """Resets every field back to the values in
    day_closure_field_config_defaults (populated once, at migration
    time, from the same seed list that created day_closure_field_configs
    itself - see that migration's docstring). Only resets the
    admin-editable columns; id/created_at are untouched, so this is a
    genuine reset of configuration, not a delete-and-recreate."""
    await session.execute(
        text("""
            UPDATE day_closure_field_configs c
            SET label = d.label, placeholder = d.placeholder, help_text = NULL,
                field_type = d.field_type, is_required = d.is_required, is_enabled = true,
                display_order = d.display_order, visible_to_field_officer = true,
                visible_to_sales_officer = true, default_value = NULL,
                updated_by = :uid, updated_at = now()
            FROM day_closure_field_config_defaults d
            WHERE c.field_key = d.field_key
        """).bindparams(uid=current_user.user_id)
    )
    # BUG FIX: previously this reset only day_closure_field_configs, so
    # admin-created CUSTOM fields survived a "Restore Defaults" and the
    # form was demonstrably not back at its default state - the message
    # said "Restored to default configuration" while an added field was
    # still sitting there.
    #
    # Soft-deleted rather than hard-deleted, consistent with the custom
    # field delete endpoint: answers already submitted against these
    # fields are kept, they simply stop being collected.
    removed = await session.execute(
        text("""
            UPDATE custom_field_definitions
            SET is_deleted = true, updated_by = :uid, updated_at = now()
            WHERE form_key = 'day_closure' AND is_deleted = false
            RETURNING field_key
        """).bindparams(uid=current_user.user_id)
    )
    removed_keys = [r.field_key for r in removed.all()]

    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_day_closure_config_restore_defaults",
        description="Admin restored Day Closure form to default configuration",
        context_data={"custom_fields_removed": removed_keys},
    )
    await _bump_config_version(session)
    await session.commit()
    result = await session.execute(text(f"SELECT {_SELECT_COLUMNS} FROM day_closure_field_configs ORDER BY display_order"))
    return [_row_to_response(row) for row in result.all()]


@router.put("/admin/day-closure-config/{field_key}", response_model=FieldConfigResponse)
async def admin_update_day_closure_config(
    field_key: str,
    payload: FieldConfigUpdateRequest,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> FieldConfigResponse:
    existing = await session.execute(
        text(f"SELECT {_SELECT_COLUMNS} FROM day_closure_field_configs WHERE field_key = :key").bindparams(key=field_key)
    )
    row = existing.first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field not found.")

    # Safety rail: this field is non-Optional in DailyVisitTrackerSubmitRequest -
    # disabling or un-requiring it would make every submission start
    # failing backend validation. Refuse rather than trust the UI alone.
    if row.backend_required:
        if payload.is_enabled is False:
            raise HTTPException(status_code=400, detail=f'"{row.label}" is required by the backend and cannot be disabled.')
        if payload.is_required is False:
            raise HTTPException(status_code=400, detail=f'"{row.label}" is required by the backend and cannot be made optional.')

    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        return _row_to_response(row)

    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    await session.execute(
        text(f"UPDATE day_closure_field_configs SET {set_clause}, updated_by = :uid, updated_at = now() WHERE field_key = :key")
        .bindparams(**fields, uid=current_user.user_id, key=field_key)
    )
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_day_closure_config_edit",
        description=f"Admin edited Day Closure field config '{field_key}'",
        context_data={"field_key": field_key, "changes": fields},
    )
    await _bump_config_version(session)
    await session.commit()

    updated = await session.execute(
        text(f"SELECT {_SELECT_COLUMNS} FROM day_closure_field_configs WHERE field_key = :key").bindparams(key=field_key)
    )
    return _row_to_response(updated.first())


# --- Sections (Part B) ---
# Previously a hardcoded SECTION_LABELS constant in
# DayClosureFormBuilder.tsx - now real, admin-manageable rows so Admin
# can rename/reorder/add a section. Deletion is intentionally
# conservative: see 202608260011's migration docstring for why a
# section is only deletable when it contains zero REAL fields (not just
# zero backend_required ones) - in practice this means only sections
# created via "Add Section" can ever be deleted.

_SECTION_SELECT = "id, section_key, label, display_order, is_original"


def _slugify_section(label: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")
    return slug or "section"


@router.get("/day-closure-sections", response_model=list[SectionResponse])
async def get_day_closure_sections(
    _current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[SectionResponse]:
    """What DayClosureForm.tsx renders its section headers from - so an
    Admin renaming/reordering/adding a section reflects on the officer
    form without a code change, same principle as the field config
    itself."""
    result = await session.execute(text(f"SELECT {_SECTION_SELECT} FROM day_closure_sections ORDER BY display_order"))
    return [SectionResponse(**dict(row._mapping)) for row in result.all()]


@router.post("/admin/day-closure-sections", response_model=SectionResponse, status_code=status.HTTP_201_CREATED)
async def admin_create_section(
    payload: SectionCreateRequest,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> SectionResponse:
    base_key = _slugify_section(payload.label)
    section_key = base_key
    suffix = 1
    while True:
        existing = await session.execute(text("SELECT 1 FROM day_closure_sections WHERE section_key = :key").bindparams(key=section_key))
        if not existing.first():
            break
        suffix += 1
        section_key = f"{base_key}_{suffix}"

    max_order = await session.execute(text("SELECT COALESCE(MAX(display_order), 0) AS m FROM day_closure_sections"))
    next_order = (max_order.first().m or 0) + 10

    new_id = uuid.uuid4()
    await session.execute(
        text("""
            INSERT INTO day_closure_sections (id, section_key, label, display_order, is_original, created_by, updated_by)
            VALUES (:id, :key, :label, :order, false, :uid, :uid)
        """).bindparams(id=new_id, key=section_key, label=payload.label, order=next_order, uid=current_user.user_id)
    )
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_day_closure_section_add",
        description=f"Admin added Day Closure section '{payload.label}'",
        context_data={"section_key": section_key},
    )
    await _bump_config_version(session)
    await session.commit()

    result = await session.execute(text(f"SELECT {_SECTION_SELECT} FROM day_closure_sections WHERE id = :id").bindparams(id=new_id))
    return SectionResponse(**dict(result.first()._mapping))


@router.put("/admin/day-closure-sections/reorder", response_model=list[SectionResponse])
async def admin_reorder_sections(
    payload: SectionReorderRequest,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[SectionResponse]:
    for item in payload.items:
        await session.execute(
            text("UPDATE day_closure_sections SET display_order = :order, updated_by = :uid, updated_at = now() WHERE section_key = :key")
            .bindparams(order=item.display_order, uid=current_user.user_id, key=item.section_key)
        )
    await _bump_config_version(session)
    await session.commit()
    result = await session.execute(text(f"SELECT {_SECTION_SELECT} FROM day_closure_sections ORDER BY display_order"))
    return [SectionResponse(**dict(row._mapping)) for row in result.all()]


@router.put("/admin/day-closure-sections/{section_key}", response_model=SectionResponse)
async def admin_rename_section(
    section_key: str,
    payload: SectionUpdateRequest,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> SectionResponse:
    existing = await session.execute(text("SELECT id FROM day_closure_sections WHERE section_key = :key").bindparams(key=section_key))
    if not existing.first():
        raise HTTPException(status_code=404, detail="Section not found.")

    await session.execute(
        text("UPDATE day_closure_sections SET label = :label, updated_by = :uid, updated_at = now() WHERE section_key = :key")
        .bindparams(label=payload.label, uid=current_user.user_id, key=section_key)
    )
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_day_closure_section_rename",
        description=f"Admin renamed Day Closure section '{section_key}' to '{payload.label}'",
        context_data={"section_key": section_key, "new_label": payload.label},
    )
    await _bump_config_version(session)
    await session.commit()

    result = await session.execute(text(f"SELECT {_SECTION_SELECT} FROM day_closure_sections WHERE section_key = :key").bindparams(key=section_key))
    return SectionResponse(**dict(result.first()._mapping))


@router.delete("/admin/day-closure-sections/{section_key}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def admin_delete_section(
    section_key: str,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    """Only deletable when it contains zero REAL fields - see this
    router's own module comment and 202608260011's migration docstring
    for why that's stricter than just checking backend_required. Custom
    fields in the section are soft-deleted along with it (the confirm-
    before-delete step on the frontend shows their count first)."""
    existing = await session.execute(text("SELECT id FROM day_closure_sections WHERE section_key = :key").bindparams(key=section_key))
    if not existing.first():
        raise HTTPException(status_code=404, detail="Section not found.")

    real_field_count = await session.execute(
        text("SELECT COUNT(*) AS cnt FROM day_closure_field_configs WHERE section = :key").bindparams(key=section_key)
    )
    if real_field_count.first().cnt > 0:
        raise HTTPException(
            status_code=400,
            detail="This section contains real form fields tied to the backend and cannot be deleted - only sections made entirely of custom fields (or empty sections) can be removed.",
        )

    await session.execute(
        text("UPDATE custom_field_definitions SET is_deleted = true, updated_by = :uid, updated_at = now() WHERE form_key = 'day_closure' AND section = :key")
        .bindparams(uid=current_user.user_id, key=section_key)
    )
    await session.execute(text("DELETE FROM day_closure_sections WHERE section_key = :key").bindparams(key=section_key))
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_day_closure_section_delete",
        description=f"Admin deleted Day Closure section '{section_key}'",
        context_data={"section_key": section_key},
    )
    await _bump_config_version(session)
    await session.commit()
