"""
Server-side enforcement of "an option that requires a description must
have one".

Exists as one shared function rather than an inline check per endpoint
so the rule cannot drift between forms - the audit that prompted this
work found exactly that: some fields had storage and no UI, others had
neither, and each form had made its own decision.

Whether an option needs a description is read from
enum_field_options.requires_description, NOT from `value == 'other'`.
Admins can create options like "Miscellaneous" at runtime, and a
hardcoded check would silently skip them - the description box would
never appear and the detail would be lost with no error.
"""

from __future__ import annotations

from typing import Iterable, Optional

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Single source of the message, so web and mobile show the same words.
VALIDATION_MESSAGE = "Please describe the other option."


async def option_requires_description(
    session: AsyncSession, field_name: str, value: Optional[str]
) -> bool:
    if not value:
        return False
    row = await session.execute(
        text("""
            SELECT requires_description FROM enum_field_options
            WHERE field_name = :f AND value = :v AND is_active = true
        """).bindparams(f=field_name, v=value)
    )
    r = row.first()
    return bool(r and r.requires_description)


async def validate_option_description(
    session: AsyncSession,
    field_name: str,
    value: Optional[str],
    description: Optional[str],
) -> None:
    """Raise 400 if `value` needs a description and none was given.

    Whitespace-only is treated as missing - "   " is not an
    explanation, and accepting it would let the frontend requirement be
    bypassed with a space.

    Deliberately silent when the option does NOT require a description,
    even if one was supplied: an officer who types something, then
    switches to a different option, should not be blocked by a stale
    value. Callers null it out on save (see the routers).
    """
    if not await option_requires_description(session, field_name, value):
        return
    if description is None or not description.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=VALIDATION_MESSAGE,
        )


async def validate_multi_option_descriptions(
    session: AsyncSession,
    field_name: str,
    values: Iterable[str],
    description: Optional[str],
) -> None:
    """Multi-select variant (pests, diseases, operations).

    The description is required while ANY selected option requires one.
    A single shared description field is used rather than one per
    option, matching the existing schema (pest_other_text is one
    column, not one per pest) - changing that would mean a migration
    and data reshaping well beyond this requirement.
    """
    vals = [v for v in (values or []) if v]
    if not vals:
        return
    rows = await session.execute(
        text("""
            SELECT 1 FROM enum_field_options
            WHERE field_name = :f AND value = ANY(:vals)
              AND is_active = true AND requires_description = true
            LIMIT 1
        """).bindparams(f=field_name, vals=vals)
    )
    if rows.first() and (description is None or not description.strip()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=VALIDATION_MESSAGE,
        )


def clear_if_not_required(required: bool, description: Optional[str]) -> Optional[str]:
    """Normalises what actually gets stored.

    Returns None when the option does not require a description, so a
    value typed and then abandoned is not persisted against an option
    it does not belong to. Also trims, so trailing whitespace is not
    stored.
    """
    if not required:
        return None
    return description.strip() if description else None
