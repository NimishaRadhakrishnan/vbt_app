"""
Admin audit trail helper.

The audit_logs table has existed since migration
202607230002_create_audit_logs_table.py, but nothing in the application
ever wrote to it. This is the one place that does - every admin
create/update/delete calls write_audit_log() so "who changed what, when"
has somewhere real to land.

BUG FIXED HERE (this file previously listed the columns as
"id, user_id, event_type, description, context_data, created_at" and
inserted exactly those): the real table ALSO has `action`,
`affected_module` and `updated_at` as NOT NULL. Every call therefore
raised NotNullViolationError, and because the audit write happens inside
the same transaction as the change it records, the WHOLE admin action
rolled back.

The user-visible symptom was a generic "Load failed" on the Day Closure
Form Builder - but it affected every admin mutation that audits:
case verify/reject, form-builder edits, enum option changes, emergency
overrides, sales closure edits. 11 router files call this helper.

`action` and `affected_module` are derived from event_type rather than
added as new parameters, so the 30+ existing call sites keep working
unchanged - the alternative was editing every one of them, with more
chances to miss one.
"""

from __future__ import annotations

import json
import uuid
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def write_audit_log(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    event_type: str,
    description: str,
    context_data: Optional[dict[str, Any]] = None,
) -> None:
    # event_type is conventionally "<actor>_<module>_<verb>", e.g.
    # "admin_custom_field_create". Split it so `action` and
    # `affected_module` carry something meaningful rather than a
    # placeholder, while keeping the helper's signature unchanged.
    parts = event_type.split("_")
    action = parts[-1] if len(parts) > 1 else event_type
    affected_module = "_".join(parts[1:-1]) if len(parts) > 2 else event_type

    await session.execute(
        text(
            """
            INSERT INTO audit_logs (
                id, user_id, event_type, description, context_data,
                action, affected_module, created_at, updated_at
            )
            VALUES (
                gen_random_uuid(), :user_id, :event_type, :description,
                CAST(:context_data AS JSONB), :action, :affected_module, now(), now()
            )
            """
        ).bindparams(
            user_id=user_id,
            event_type=event_type,
            description=description,
            context_data=json.dumps(context_data or {}, default=str),
            action=action,
            affected_module=affected_module,
        )
    )
