"""
Emergency override lookup.

One shared implementation, deliberately: the 17:30 warning and the
logout gate must agree about whether an override is active. If they
diverged, an officer could be told "you don't need to close today" and
then be blocked from logging out — the worst possible combination.

An override suppresses ENFORCEMENT only. It does not change working
hours and does not prevent an officer submitting a closure if they want
to (approved §6g).
"""

from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.config.company_time import company_now


async def active_override_for(
    session: AsyncSession, officer_id: uuid.UUID, role: str
) -> Optional[dict]:
    """The override currently covering this officer, or None.

    Scope rules (approved): a NULL scope_role or scope_district means
    "all". A non-null value narrows. District membership is resolved
    through user_territories -> territories.district, because `users`
    has no district column of its own.

    `is_active` is checked alongside the time window so an admin's
    manual cancel takes effect immediately, without waiting for ends_at.

    Ordered so the broadest match wins ties deterministically - two
    overlapping declarations should never produce different answers on
    different requests.
    """
    now = company_now()
    result = await session.execute(
        text("""
            SELECT o.id, o.reason, o.starts_at, o.ends_at, o.scope_role, o.scope_district
            FROM emergency_overrides o
            WHERE o.is_active = true
              AND o.starts_at <= :now
              AND o.ends_at   >= :now
              AND (o.scope_role IS NULL OR o.scope_role = :role)
              AND (
                    o.scope_district IS NULL
                 OR EXISTS (
                        SELECT 1
                        FROM user_territories ut
                        JOIN territories t ON t.id = ut.territory_id
                        WHERE ut.user_id = :officer_id
                          AND lower(t.district) = lower(o.scope_district)
                    )
              )
            ORDER BY (o.scope_role IS NULL) DESC, (o.scope_district IS NULL) DESC, o.created_at DESC
            LIMIT 1
        """).bindparams(now=now, role=role, officer_id=officer_id)
    )
    row = result.first()
    if not row:
        return None
    return {
        "id": str(row.id),
        "reason": row.reason,
        "starts_at": row.starts_at.isoformat() if row.starts_at else None,
        "ends_at": row.ends_at.isoformat() if row.ends_at else None,
        "scope_role": row.scope_role,
        "scope_district": row.scope_district,
    }


async def is_override_active(session: AsyncSession, officer_id: uuid.UUID, role: str) -> bool:
    """Convenience wrapper.

    Any failure resolves to False - i.e. enforcement continues as
    normal. Failing the other way would let a database problem silently
    switch off a compliance rule across the whole organisation, which is
    a far worse outcome than an officer briefly being asked to close a
    day during an emergency.
    """
    try:
        return await active_override_for(session, officer_id, role) is not None
    except Exception:
        return False
