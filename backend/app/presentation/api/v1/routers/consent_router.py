"""
Location consent router - Phase 3a item 6.

Serves the prominent-disclosure text the mobile app must show before
requesting location permissions, records acceptances, and exposes the
`require_location_consent` guard that makes the consent load-bearing
rather than decorative.

The guard is the part that matters. A disclosure screen the client can
skip - by an older build, a modified APK, or simply a bug - would give
us a consent log full of holes and a tracking system running without
permission for some unknown subset of officers. Enforcing server-side at
check-in means the sentence "we do not track anyone who has not agreed"
is true by construction, not by trust in the client.

Raw SQL rather than the domain/repository layering, matching the house
style of the other recently-added routers (day_closure, task, leave,
sales_stock). Flagged in the plan as a convergence decision; not
relitigated here.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.value_objects.role import Role
from app.infrastructure.audit.audit_log import write_audit_log
from app.infrastructure.database.session import get_db_session
from app.presentation.api.v1.dependencies import CurrentUser, require_role

router = APIRouter(tags=["location-consent"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class DisclosurePoint(BaseModel):
    label: str
    text: str


class ConsentStatusResponse(BaseModel):
    required_version: int
    accepted_version: int | None = None
    accepted_at: datetime | None = None
    retention_months: int
    title: str
    points: list[DisclosurePoint]
    footer: str


class AcceptConsentRequest(BaseModel):
    version: int = Field(ge=1)
    source: str = Field(default="server", pattern="^(server|bundled_fallback)$")
    device_id: str | None = None
    app_version: str | None = None


class AcceptConsentResponse(BaseModel):
    accepted_version: int
    accepted_at: datetime


class ConsentAuditRow(BaseModel):
    user_id: uuid.UUID
    full_name: str
    role: str
    accepted_version: int | None = None
    accepted_at: datetime | None = None
    source: str | None = None
    is_current: bool


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _active_disclosure(session: AsyncSession) -> Any:
    row = (
        await session.execute(
            text(
                """
                SELECT version, title, points, footer, retention_months
                FROM location_disclosure_versions
                WHERE is_active
                """
            )
        )
    ).first()

    if row is None:
        # Fail closed and loudly. An empty disclosure table means the
        # mobile app has nothing to show, and silently returning a
        # default here would let officers be tracked against a
        # disclosure that exists nowhere in the record.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No active location disclosure is configured.",
        )
    return row


async def _accepted_version(session: AsyncSession, user_id: uuid.UUID) -> Any:
    return (
        await session.execute(
            text(
                """
                SELECT disclosure_version, accepted_at
                FROM location_consent_acceptances
                WHERE user_id = :user_id
                ORDER BY disclosure_version DESC, accepted_at DESC
                LIMIT 1
                """
            ).bindparams(user_id=user_id)
        )
    ).first()


# ---------------------------------------------------------------------------
# Officer endpoints
# ---------------------------------------------------------------------------


@router.get("/consent/location", response_model=ConsentStatusResponse)
async def get_location_consent(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> ConsentStatusResponse:
    """Disclosure to show, plus whether this officer has already accepted it."""
    disclosure = await _active_disclosure(session)
    accepted = await _accepted_version(session, current_user.user_id)

    return ConsentStatusResponse(
        required_version=disclosure.version,
        accepted_version=accepted.disclosure_version if accepted else None,
        accepted_at=accepted.accepted_at if accepted else None,
        retention_months=disclosure.retention_months,
        title=disclosure.title,
        points=[DisclosurePoint(**p) for p in disclosure.points],
        footer=disclosure.footer,
    )


@router.post(
    "/consent/location",
    response_model=AcceptConsentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def accept_location_consent(
    payload: AcceptConsentRequest,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AcceptConsentResponse:
    disclosure = await _active_disclosure(session)

    # Reject acceptance of a version that is not the current one. A
    # stale app build accepting version 1 after version 2 is published
    # must not be recorded as consent to version 2 - that would be a
    # false record of what the officer agreed to. The client re-fetches
    # and shows the new text instead.
    if payload.version != disclosure.version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This notice has been updated. "
                "Please reopen the app to see the current version."
            ),
        )

    now = datetime.now(UTC)
    await session.execute(
        text(
            """
            INSERT INTO location_consent_acceptances
                (id, user_id, disclosure_version, accepted_at, source, device_id, app_version)
            VALUES
                (gen_random_uuid(), :user_id, :version, :accepted_at,
                 :source, :device_id, :app_version)
            """
        ).bindparams(
            user_id=current_user.user_id,
            version=payload.version,
            accepted_at=now,
            source=payload.source,
            device_id=payload.device_id,
            app_version=payload.app_version,
        )
    )

    await write_audit_log(
        session,
        user_id=current_user.user_id,
        event_type="officer_location_consent_accept",
        description=f"Accepted location disclosure v{payload.version}",
        context_data={"version": payload.version, "source": payload.source},
    )
    await session.commit()

    return AcceptConsentResponse(accepted_version=payload.version, accepted_at=now)


# ---------------------------------------------------------------------------
# Admin endpoint
# ---------------------------------------------------------------------------


@router.get("/admin/consent/location", response_model=list[ConsentAuditRow])
async def admin_list_location_consent(
    _current_user: Annotated[object, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[ConsentAuditRow]:
    """Who has accepted the current disclosure, and who has not.

    This is the evidence artefact: if a Play reviewer, an auditor or the
    company's own advisor asks "can you show that every tracked employee
    was told and agreed?", this endpoint is the answer. LEFT JOIN from
    users so officers who have NOT accepted appear as rows rather than
    being invisible by omission - the non-acceptances are the important
    half.
    """
    disclosure = await _active_disclosure(session)

    rows = await session.execute(
        text(
            """
            SELECT u.id AS user_id, u.full_name, u.role,
                   a.disclosure_version, a.accepted_at, a.source
            FROM users u
            LEFT JOIN LATERAL (
                SELECT disclosure_version, accepted_at, source
                FROM location_consent_acceptances
                WHERE user_id = u.id
                ORDER BY disclosure_version DESC, accepted_at DESC
                LIMIT 1
            ) a ON true
            WHERE u.is_active AND NOT u.is_deleted
            ORDER BY u.full_name ASC
            """
        )
    )

    return [
        ConsentAuditRow(
            user_id=r.user_id,
            full_name=r.full_name,
            role=r.role,
            accepted_version=r.disclosure_version,
            accepted_at=r.accepted_at,
            source=r.source,
            is_current=(r.disclosure_version or 0) >= disclosure.version,
        )
        for r in rows.all()
    ]


# ---------------------------------------------------------------------------
# Guard
# ---------------------------------------------------------------------------


async def require_location_consent(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    """Blocks an action when the officer has not accepted the current disclosure.

    Applied to check-in (attendance_router), because check-in is the
    action that starts tracking. Deliberately NOT applied to the rest of
    the app: declining the disclosure must leave a usable app, or the
    "Not now" path is coerced consent rather than a real choice.

    Admins are exempt - they are not tracked, and locking an admin out of
    a check-in endpoint they can legitimately call on an officer's behalf
    would be an unrelated failure.
    """
    if current_user.role == Role.ADMIN.value:
        return

    disclosure = await _active_disclosure(session)
    accepted = await _accepted_version(session, current_user.user_id)

    if accepted is None or accepted.disclosure_version < disclosure.version:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Please read and accept the location notice before checking in. "
                "You can find it on the home screen."
            ),
        )
