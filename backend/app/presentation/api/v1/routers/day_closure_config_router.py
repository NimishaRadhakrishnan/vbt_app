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
    "default_value, backend_required, is_deleted, updated_at"
)


def _row_to_response(row) -> FieldConfigResponse:
    return FieldConfigResponse(
        id=row.id, field_key=row.field_key, section=row.section, label=row.label,
        placeholder=row.placeholder, help_text=row.help_text, field_type=row.field_type,
        is_required=row.is_required, is_enabled=row.is_enabled, display_order=row.display_order,
        visible_to_field_officer=row.visible_to_field_officer,
        visible_to_sales_officer=row.visible_to_sales_officer,
        default_value=row.default_value, backend_required=row.backend_required,
        is_deleted=row.is_deleted, updated_at=row.updated_at,
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
    # One Officer role now: a field shows if it was ever made visible to
    # either of the two former roles.
    where_role = (
        "AND (visible_to_field_officer = true OR visible_to_sales_officer = true)"
        if current_user.role == "field_officer" else ""
    )
    result = await session.execute(
        text(f"SELECT {_SELECT_COLUMNS} FROM day_closure_field_configs WHERE is_enabled = true AND is_deleted = false {where_role} ORDER BY display_order")
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
    form: str = "farm",
) -> list[FieldConfigResponse]:
    """Puts ONE form (farm = Field Officer, sales = Sales Officer) back to
    the original: every built-in field gets its default label, order and
    required-ness and is un-deleted, and fields the admin added to that form
    are removed. Answers already submitted are kept."""
    if form not in ("farm", "sales"):
        raise HTTPException(status_code=400, detail="form must be 'farm' or 'sales'.")
    key_filter = "c.field_key LIKE 'sales\\_%'" if form == "sales" else "c.field_key NOT LIKE 'sales\\_%'"
    await session.execute(
        text(f"""
            UPDATE day_closure_field_configs c
            SET label = d.label, placeholder = d.placeholder, help_text = NULL,
                field_type = d.field_type, is_required = d.is_required, is_enabled = true,
                is_deleted = COALESCE(d.default_deleted, false),
                display_order = d.display_order, visible_to_field_officer = true,
                visible_to_sales_officer = true, default_value = NULL,
                updated_by = :uid, updated_at = now()
            FROM day_closure_field_config_defaults d
            WHERE c.field_key = d.field_key AND {key_filter}
        """).bindparams(uid=current_user.user_id)
    )
    form_key = "sales_day_closure" if form == "sales" else "day_closure"
    await session.execute(
        text("UPDATE day_closure_sections SET is_deleted = false, label = COALESCE(default_label, label), display_order = COALESCE(default_order, display_order) WHERE is_original = true AND form_kind = :f")
        .bindparams(f=form)
    )
    await session.execute(
        text("DELETE FROM day_closure_sections WHERE is_original = false AND form_kind = :f").bindparams(f=form)
    )
    removed = await session.execute(
        text("""
            UPDATE custom_field_definitions
            SET is_deleted = true, updated_by = :uid, updated_at = now()
            WHERE form_key = :fk AND is_deleted = false
            RETURNING field_key
        """).bindparams(uid=current_user.user_id, fk=form_key)
    )
    removed_keys = [r.field_key for r in removed.all()]

    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_day_closure_config_restore_defaults",
        description=f"Admin restored the {form} Day Closure form to its default configuration",
        context_data={"form": form, "custom_fields_removed": removed_keys},
    )
    await _bump_config_version(session, form_key)
    await session.commit()
    result = await session.execute(text(f"SELECT {_SELECT_COLUMNS} FROM day_closure_field_configs ORDER BY display_order"))
    return [_row_to_response(row) for row in result.all()]


@router.delete("/admin/day-closure-config/{field_key}", response_model=FieldConfigResponse)
async def admin_delete_day_closure_field(
    field_key: str,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> FieldConfigResponse:
    """Removes a built-in field from the officers' form. Soft delete: the
    row stays so Restore defaults can bring it back and old answers still
    display. Fields the backend cannot work without are refused."""
    existing = await session.execute(
        text(f"SELECT {_SELECT_COLUMNS} FROM day_closure_field_configs WHERE field_key = :key").bindparams(key=field_key)
    )
    row = existing.first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field not found.")
    if row.backend_required:
        raise HTTPException(status_code=400, detail=f'"{row.label}" is needed by the app and cannot be deleted. You can rename it.')
    await session.execute(
        text("UPDATE day_closure_field_configs SET is_deleted = true, updated_by = :uid, updated_at = now() WHERE field_key = :key")
        .bindparams(uid=current_user.user_id, key=field_key)
    )
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_day_closure_field_delete",
        description=f"Admin deleted Day Closure field '{field_key}'",
        context_data={"field_key": field_key},
    )
    await _bump_config_version(session, "sales_day_closure" if field_key.startswith("sales_") else "day_closure")
    await session.commit()
    updated = await session.execute(
        text(f"SELECT {_SELECT_COLUMNS} FROM day_closure_field_configs WHERE field_key = :key").bindparams(key=field_key)
    )
    return _row_to_response(updated.first())


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

_SECTION_SELECT = "id, section_key, label, display_order, is_original, form_kind"


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
    result = await session.execute(text(f"SELECT {_SECTION_SELECT} FROM day_closure_sections WHERE is_deleted = false ORDER BY display_order"))
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
            INSERT INTO day_closure_sections (id, section_key, label, display_order, is_original, form_kind, created_by, updated_by)
            VALUES (:id, :key, :label, :order, false, :form, :uid, :uid)
        """).bindparams(form=('sales' if payload.form == 'sales' else 'farm'), id=new_id, key=section_key, label=payload.label, order=next_order, uid=current_user.user_id)
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
    result = await session.execute(text(f"SELECT {_SECTION_SELECT} FROM day_closure_sections WHERE is_deleted = false ORDER BY display_order"))
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

    locked = await session.execute(
        text("SELECT COUNT(*) AS cnt FROM day_closure_field_configs WHERE section = :key AND backend_required = true AND is_deleted = false")
        .bindparams(key=section_key)
    )
    if locked.first().cnt > 0:
        raise HTTPException(
            status_code=400,
            detail="This section holds fields the app cannot work without, so it cannot be deleted. You can rename it, or delete its other fields.",
        )
    # Everything else in the section goes with it (Restore defaults brings it back).
    await session.execute(
        text("UPDATE day_closure_field_configs SET is_deleted = true, updated_by = :uid, updated_at = now() WHERE section = :key")
        .bindparams(uid=current_user.user_id, key=section_key)
    )
    await session.execute(
        text("UPDATE custom_field_definitions SET is_deleted = true, updated_by = :uid, updated_at = now() WHERE form_key IN ('day_closure','sales_day_closure') AND section = :key")
        .bindparams(uid=current_user.user_id, key=section_key)
    )
    # Original sections are only hidden so Restore defaults can bring them back.
    await session.execute(
        text("UPDATE day_closure_sections SET is_deleted = true WHERE section_key = :key AND is_original = true")
        .bindparams(key=section_key)
    )
    await session.execute(text("DELETE FROM day_closure_sections WHERE section_key = :key AND is_original = false").bindparams(key=section_key))
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_day_closure_section_delete",
        description=f"Admin deleted Day Closure section '{section_key}'",
        context_data={"section_key": section_key},
    )
    await _bump_config_version(session)
    await session.commit()
