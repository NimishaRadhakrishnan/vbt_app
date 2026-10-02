import json
import uuid
from typing import Any
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

# Defined custom field types to match frontend.
CUSTOM_FIELD_TYPES = ["text", "number", "date", "select", "textarea", "checkbox"]

async def validate_and_save_custom_answers(
    session: AsyncSession,
    form_key: str,
    record_id: uuid.UUID,
    answers: dict[str, Any] | None,
    client_version: int | str | None,
    user_id: uuid.UUID,
    role: str
) -> None:
    answers = answers or {}

    # 1. Fetch current server version
    version_result = await session.execute(
        text("SELECT version FROM form_config_versions WHERE form_key = :form_key")
        .bindparams(form_key=form_key)
    )
    v_row = version_result.first()
    server_version = v_row.version if v_row else 1

    try:
        is_current = int(client_version) == server_version
    except (TypeError, ValueError):
        is_current = False

    # 2. Fetch all definitions for this form
    defs = await session.execute(
        text("SELECT field_key, field_type, is_enabled, is_required, is_deleted, visible_to_field_officer, visible_to_sales_officer, visible_to_manager FROM custom_field_definitions WHERE form_key = :form_key")
        .bindparams(form_key=form_key)
    )
    definitions = {row.field_key: dict(row._mapping) for row in defs.all()}

    # 3. Validate answers
    to_insert = {}
    for key, val in answers.items():
        if key not in definitions:
            raise HTTPException(status_code=400, detail=f"Unknown custom field: {key}")
        
        df = definitions[key]
        
        # Check visibility
        is_visible = False
        if role == "field_officer":
            is_visible = df["visible_to_field_officer"]
        elif role == "sales_officer":
            is_visible = df["visible_to_sales_officer"]
        elif role in ("admin", "manager"):
            is_visible = df["visible_to_manager"]
            
        # If client is current, reject answers for invisible/disabled/deleted fields.
        if is_current:
            if not is_visible or not df["is_enabled"] or df["is_deleted"]:
                raise HTTPException(status_code=400, detail=f"Cannot submit answer for disabled/invisible field: {key}")
        
        # Type enforcement
        ftype = df["field_type"]
        if ftype == "checkbox":
            if str(val).lower() in ("true", "1", "yes", "on"):
                val = True
            elif str(val).lower() in ("false", "0", "no", "off", "none", "null"):
                val = False
            else:
                val = bool(val)
        elif ftype == "number":
            if val is not None and val != "":
                try:
                    val = float(val)
                except ValueError:
                    raise HTTPException(status_code=400, detail=f"Invalid number for field {key}")
        elif ftype == "photos":
            if not isinstance(val, list):
                val = [val] if val else []
        elif ftype in ("text", "textarea", "date", "select"):
            if val is not None:
                val = str(val)

        to_insert[key] = val

    # 4. Check required fields
    if is_current:
        for key, df in definitions.items():
            if df["is_deleted"] or not df["is_enabled"]:
                continue
            is_visible = False
            if role == "field_officer":
                is_visible = df["visible_to_field_officer"]
            elif role == "sales_officer":
                is_visible = df["visible_to_sales_officer"]
            elif role in ("admin", "manager"):
                is_visible = df["visible_to_manager"]
                
            if is_visible and df["is_required"]:
                if key not in to_insert or to_insert[key] in (None, "", []):
                    raise HTTPException(status_code=400, detail=f"Custom field {key} is required.")

    # 5. Insert answers transactionally
    for key, val in to_insert.items():
        await session.execute(
            text("""
                INSERT INTO custom_field_answers (id, form_key, record_id, field_key, value, submitted_by)
                VALUES (gen_random_uuid(), :form_key, :record_id, :field_key, CAST(:value AS JSONB), :uid)
                ON CONFLICT (form_key, record_id, field_key) DO UPDATE SET value = EXCLUDED.value
            """).bindparams(form_key=form_key, record_id=record_id, field_key=key, value=json.dumps(val), uid=user_id)
        )
