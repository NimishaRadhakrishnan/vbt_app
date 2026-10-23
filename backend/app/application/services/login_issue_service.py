"""Login issues: record a blocked sign-in, tell the admins, keep the trail.

Called from the login use case AFTER the password has been verified, so only
someone holding the right password can raise a request (no spamming admins
by guessing names). Runs in its own session and commits on its own, because
the login itself is about to be answered with a 401 that rolls the request's
transaction back.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import text

from app.infrastructure.database.models.notification_model import NotificationModel
from app.infrastructure.database.session import AsyncSessionLocal

logger = logging.getLogger(__name__)

# After an admin rejects a request, the same device cannot raise another one
# straight away; this keeps a rejected officer from re-filing every minute.
REJECT_COOLDOWN = timedelta(minutes=10)

ISSUE_LABELS = {
    "device_mismatch": "Signing in from a different phone",
    "account_inactive": "Account is deactivated",
    "other": "Other sign-in problem",
}


async def add_event(session, issue_id, event_type: str, *, actor_id=None, actor_name: Optional[str] = None, detail: Optional[str] = None) -> None:
    await session.execute(
        text(
            "INSERT INTO login_issue_events (issue_id, event_type, actor_id, actor_name, detail, created_at) "
            "VALUES (:i, :e, :a, :n, :d, clock_timestamp())"
        ),
        {"i": issue_id, "e": event_type, "a": actor_id, "n": actor_name, "d": detail},
    )


async def notify_user(session, user_id, title: str, message: str, kind: str = "login_issue") -> None:
    session.add(NotificationModel(user_id=user_id, title=title, message=message, type=kind, is_read=False))


async def notify_admins(session, title: str, message: str) -> int:
    rows = await session.execute(
        text("SELECT id FROM users WHERE role = 'admin' AND is_active = true AND is_deleted = false")
    )
    ids = [r[0] for r in rows.all()]
    for aid in ids:
        await notify_user(session, aid, title, message)
    return len(ids)


async def report_login_issue(
    *,
    user_id: uuid.UUID,
    full_name: str,
    employee_id: Optional[str],
    issue_type: str,
    attempted_device_id: Optional[str],
    device_name: Optional[str],
    bound_device_id: Optional[str],
    description: Optional[str],
    ip_address: Optional[str],
) -> dict:
    """Create (or add to) the officer's open request. Returns id, status, note."""
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as session:
        latest = (
            await session.execute(
                text(
                    """
                    SELECT id, status, resolution_note, resolved_at, attempt_count
                    FROM login_issues
                    WHERE user_id = :u AND issue_type = :t
                      AND attempted_device_id IS NOT DISTINCT FROM :d
                    ORDER BY created_at DESC LIMIT 1
                    """
                ),
                {"u": user_id, "t": issue_type, "d": attempted_device_id},
            )
        ).first()

        if latest and latest.status == "pending":
            await session.execute(
                text("UPDATE login_issues SET attempt_count = attempt_count + 1, last_attempt_at = :n WHERE id = :i"),
                {"n": now, "i": latest.id},
            )
            await add_event(session, latest.id, "attempt_again", detail=f"Tried again (attempt {latest.attempt_count + 1})")
            await session.commit()
            return {"id": str(latest.id), "status": "pending", "note": None, "new": False}

        if latest and latest.status == "rejected" and latest.resolved_at and now - latest.resolved_at < REJECT_COOLDOWN:
            await session.execute(
                text("UPDATE login_issues SET attempt_count = attempt_count + 1, last_attempt_at = :n WHERE id = :i"),
                {"n": now, "i": latest.id},
            )
            await add_event(session, latest.id, "attempt_after_reject", detail="Tried again right after rejection")
            await session.commit()
            return {"id": str(latest.id), "status": "rejected", "note": latest.resolution_note, "new": False}

        issue_id = (
            await session.execute(
                text(
                    """
                    INSERT INTO login_issues
                        (user_id, issue_type, description, attempted_device_id, device_name,
                         bound_device_id, ip_address)
                    VALUES (:u, :t, :desc, :d, :dn, :b, :ip) RETURNING id
                    """
                ),
                {
                    "u": user_id, "t": issue_type, "desc": description, "d": attempted_device_id,
                    "dn": device_name, "b": bound_device_id, "ip": ip_address,
                },
            )
        ).scalar_one()
        await add_event(
            session, issue_id, "created", actor_id=user_id, actor_name=full_name,
            detail=f"{ISSUE_LABELS.get(issue_type, issue_type)}; device {device_name or attempted_device_id or 'unknown'}",
        )
        await session.execute(
            text("UPDATE users SET login_status = 'pending_review' WHERE id = :u"), {"u": user_id}
        )
        who = f"{full_name} ({employee_id or 'no ID'})"
        await notify_admins(
            session,
            "Officer login needs your approval",
            f"{who}: {ISSUE_LABELS.get(issue_type, issue_type)}. "
            f"Device: {device_name or attempted_device_id or 'unknown'}. Open Login Requests to approve or reject.",
        )
        await add_event(session, issue_id, "admins_notified")
        await session.commit()
        return {"id": str(issue_id), "status": "pending", "note": None, "new": True}
