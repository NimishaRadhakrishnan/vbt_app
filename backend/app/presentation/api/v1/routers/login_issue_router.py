"""Officer login issues: the admin's queue and the audit trail.

A held sign-in (different phone, deactivated account) is recorded by
login_issue_service when the officer tries to sign in with the right
password. Here the admin sees who, on which device, and why, and decides.

  approve_device   register the phone the officer tried (device_mismatch)
  authorize_login  switch the account back on and clear lockouts
                   (account_inactive / other)
  rectify          unregister the phone so the next sign-in registers
                   whichever phone it comes from; clears lockouts
  reject           refuse, with a reason the officer is shown

Admin only. Every action is written to the request's own event history,
the platform audit log, and the officer's notifications.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.services.login_issue_service import add_event, notify_user
from app.core.container import get_redis
from app.domain.value_objects.role import Role
from app.infrastructure.audit.audit_log import write_audit_log
from app.infrastructure.database.session import get_db_session
from app.presentation.api.v1.dependencies import CurrentUser, require_role
from app.presentation.middleware.rate_limiter import clear_login_rate_limit

router = APIRouter(prefix="/login-issues", tags=["login-issues"])

AdminUser = Annotated[object, Depends(require_role(Role.ADMIN))]


class LoginIssueOut(BaseModel):
    id: uuid.UUID
    ref: str
    user_id: uuid.UUID
    officer_name: str
    employee_id: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    issue_type: str
    status: str
    description: Optional[str] = None
    attempted_device_id: Optional[str] = None
    device_name: Optional[str] = None
    registered_device_id: Optional[str] = None
    account_active: bool
    login_status: str
    ip_address: Optional[str] = None
    attempt_count: int
    last_attempt_at: datetime
    created_at: datetime
    resolution_action: Optional[str] = None
    resolution_note: Optional[str] = None
    resolved_by_name: Optional[str] = None
    resolved_at: Optional[datetime] = None


class LoginIssueEventOut(BaseModel):
    id: uuid.UUID
    issue_id: uuid.UUID
    ref: str
    officer_name: str
    event_type: str
    actor_name: Optional[str] = None
    detail: Optional[str] = None
    created_at: datetime


class LoginIssueDetail(LoginIssueOut):
    events: list[LoginIssueEventOut] = []


class ActionInput(BaseModel):
    action: Literal["approve_device", "authorize_login", "rectify", "reject"]
    note: Optional[str] = Field(default=None, max_length=500)


_SELECT = """
    SELECT li.*, u.full_name AS officer_name, u.employee_id, u.email, u.phone,
           u.device_id AS registered_device_id, u.is_active AS account_active,
           u.login_status, rb.full_name AS resolved_by_name
    FROM login_issues li
    JOIN users u ON u.id = li.user_id
    LEFT JOIN users rb ON rb.id = li.resolved_by
"""


def _issue(r) -> LoginIssueOut:
    return LoginIssueOut(
        id=r.id, ref=str(r.id)[:8].upper(), user_id=r.user_id, officer_name=r.officer_name,
        employee_id=r.employee_id, email=r.email, phone=r.phone, issue_type=r.issue_type,
        status=r.status, description=r.description, attempted_device_id=r.attempted_device_id,
        device_name=r.device_name, registered_device_id=r.registered_device_id,
        account_active=r.account_active, login_status=r.login_status, ip_address=r.ip_address,
        attempt_count=r.attempt_count, last_attempt_at=r.last_attempt_at, created_at=r.created_at,
        resolution_action=r.resolution_action, resolution_note=r.resolution_note,
        resolved_by_name=r.resolved_by_name, resolved_at=r.resolved_at,
    )


def _event(r) -> LoginIssueEventOut:
    return LoginIssueEventOut(
        id=r.id, issue_id=r.issue_id, ref=str(r.issue_id)[:8].upper(), officer_name=r.officer_name,
        event_type=r.event_type, actor_name=r.actor_name, detail=r.detail, created_at=r.created_at,
    )


@router.get("", response_model=list[LoginIssueOut])
async def list_login_issues(
    _: AdminUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    status_filter: Optional[Literal["pending", "resolved", "rejected"]] = None,
    limit: int = 100,
    offset: int = 0,
) -> list[LoginIssueOut]:
    q = _SELECT + " WHERE (CAST(:s AS TEXT) IS NULL OR li.status = CAST(:s AS TEXT)) "
    q += " ORDER BY (li.status = 'pending') DESC, li.last_attempt_at DESC LIMIT :l OFFSET :o"
    rows = await session.execute(text(q).bindparams(s=status_filter, l=min(limit, 500), o=offset))
    return [_issue(r) for r in rows.all()]


@router.get("/pending-count")
async def pending_count(_: AdminUser, session: Annotated[AsyncSession, Depends(get_db_session)]) -> dict:
    n = (await session.execute(text("SELECT count(*) FROM login_issues WHERE status = 'pending'"))).scalar_one()
    return {"pending": int(n)}


@router.get("/mine", response_model=list[LoginIssueOut])
async def my_login_issues(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[LoginIssueOut]:
    """The signed-in officer's own past requests and how they ended."""
    rows = await session.execute(
        text(_SELECT + " WHERE li.user_id = :u ORDER BY li.created_at DESC LIMIT 20").bindparams(u=current_user.user_id)
    )
    return [_issue(r) for r in rows.all()]


@router.get("/audit", response_model=list[LoginIssueEventOut])
async def audit_trail(
    _: AdminUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    user_id: Optional[uuid.UUID] = None,
    limit: int = 200,
    offset: int = 0,
) -> list[LoginIssueEventOut]:
    """Every request event and admin action, newest first."""
    rows = await session.execute(
        text(
            """
            SELECT e.*, u.full_name AS officer_name
            FROM login_issue_events e
            JOIN login_issues li ON li.id = e.issue_id
            JOIN users u ON u.id = li.user_id
            WHERE (CAST(:u AS UUID) IS NULL OR li.user_id = CAST(:u AS UUID))
            ORDER BY e.created_at DESC, e.id DESC LIMIT :l OFFSET :o
            """
        ).bindparams(u=str(user_id) if user_id else None, l=min(limit, 1000), o=offset)
    )
    return [_event(r) for r in rows.all()]


@router.get("/{issue_id}", response_model=LoginIssueDetail)
async def get_login_issue(
    issue_id: uuid.UUID,
    _: AdminUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> LoginIssueDetail:
    row = (await session.execute(text(_SELECT + " WHERE li.id = :i").bindparams(i=issue_id))).first()
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    events = await session.execute(
        text(
            "SELECT e.*, :n AS officer_name FROM login_issue_events e WHERE e.issue_id = :i ORDER BY e.created_at, e.id"
        ).bindparams(i=issue_id, n=row.officer_name)
    )
    return LoginIssueDetail(**_issue(row).model_dump(), events=[_event(e) for e in events.all()])


_OFFICER_MESSAGES = {
    "approve_device": ("Your new phone is approved", "Your admin approved this phone. You can sign in now."),
    "authorize_login": ("Your sign-in is allowed", "Your admin has fixed your account. You can sign in now."),
    "rectify": ("Your sign-in problem is fixed", "Your admin reset your phone registration. Sign in now; the phone you use will be registered."),
    "reject": ("Your sign-in request was declined", "Your admin declined the request."),
}


@router.post("/{issue_id}/action", response_model=LoginIssueDetail)
async def act_on_login_issue(
    issue_id: uuid.UUID,
    payload: ActionInput,
    admin: Annotated[object, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> LoginIssueDetail:
    note = (payload.note or "").strip() or None
    if payload.action in ("reject", "rectify") and not note:
        raise HTTPException(status_code=400, detail="Please write a short note for this action.")

    row = (
        await session.execute(
            text(
                "SELECT li.*, u.full_name AS officer_name, u.employee_id, u.email, u.is_active AS u_active "
                "FROM login_issues li JOIN users u ON u.id = li.user_id WHERE li.id = :i FOR UPDATE OF li"
            ).bindparams(i=issue_id)
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    if row.status != "pending":
        raise HTTPException(status_code=409, detail="This request was already handled.")

    if payload.action == "approve_device":
        if row.issue_type != "device_mismatch" or not row.attempted_device_id:
            raise HTTPException(status_code=400, detail="Approve device only applies to a new-phone request.")
    if payload.action == "authorize_login" and row.issue_type == "device_mismatch":
        raise HTTPException(status_code=400, detail="This is a new-phone request: use Approve device, or Reset device.")

    uid = row.user_id
    if payload.action == "approve_device":
        await session.execute(
            text("UPDATE users SET device_id = :d, failed_logins = 0, login_status = 'active' WHERE id = :u"),
            {"d": row.attempted_device_id, "u": uid},
        )
        effect = f"Registered phone {row.device_name or row.attempted_device_id}"
    elif payload.action == "authorize_login":
        await session.execute(
            text("UPDATE users SET is_active = true, failed_logins = 0, login_status = 'active' WHERE id = :u"),
            {"u": uid},
        )
        effect = "Account switched on and lockouts cleared"
    elif payload.action == "rectify":
        await session.execute(
            text("UPDATE users SET device_id = NULL, failed_logins = 0, login_status = 'active' WHERE id = :u"),
            {"u": uid},
        )
        effect = "Phone registration cleared; the next sign-in registers its phone"
    else:  # reject
        await session.execute(text("UPDATE users SET login_status = 'blocked' WHERE id = :u"), {"u": uid})
        effect = "Request declined"

    new_status = "rejected" if payload.action == "reject" else "resolved"
    await session.execute(
        text(
            "UPDATE login_issues SET status = :s, resolution_action = :a, resolution_note = :n, "
            "resolved_by = :b, resolved_at = now() WHERE id = :i"
        ),
        {"s": new_status, "a": payload.action, "n": note, "b": admin.user_id, "i": issue_id},
    )
    await add_event(
        session, issue_id, payload.action, actor_id=admin.user_id, actor_name=admin.full_name,
        detail=f"{effect}" + (f". Note: {note}" if note else ""),
    )

    title, body = _OFFICER_MESSAGES[payload.action]
    if note:
        body += f" Note from admin: {note}"
    await notify_user(session, uid, title, body, kind="login_resolved")
    await add_event(session, issue_id, "officer_notified", detail=title)
    await write_audit_log(
        session,
        user_id=admin.user_id,
        event_type=f"admin_login_issue_{payload.action}",
        description=f"{payload.action} for {row.officer_name} ({row.employee_id or row.email})",
        context_data={"issue_id": str(issue_id), "user_id": str(uid), "note": note, "effect": effect},
    )
    await session.commit()

    # The officer may be throttled from earlier tries; let them in at once.
    for ident in (row.employee_id, row.email):
        await clear_login_rate_limit(ident, redis)

    return await get_login_issue(issue_id, admin, session)
