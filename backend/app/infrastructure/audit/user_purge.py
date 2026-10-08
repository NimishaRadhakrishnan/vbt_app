"""Permanent removal of an archived user and the data that belongs to them.

Foreign keys that point at ``users`` are handled by kind:
  * CASCADE / SET NULL  - the database does it.
  * RESTRICT, nullable column  - set to NULL (the record stays, unattributed).
  * RESTRICT, NOT NULL, audit-style column (created_by, approved_by ...)
    - re-assigned to the admin doing the delete so shared records survive.
  * RESTRICT, NOT NULL, owner-style column (officer_id, user_id ...)
    - the row is deleted, after deleting its own RESTRICT children first.
Everything runs in the caller's transaction; the caller commits or rolls back.
"""
from __future__ import annotations

import re
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_.\"]*$")
_AUDIT_COLS = {
    "created_by", "updated_by", "deleted_by", "approved_by", "reviewed_by",
    "assigned_by", "verified_by", "rejected_by", "decided_by", "uploaded_by",
    "closed_by", "resolved_by", "modified_by", "actor_id", "granted_by",
}
_FK_SQL = """
    SELECT c.conrelid::regclass::text, a.attname, c.confdeltype, a.attnotnull
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confrelid = CAST(:t AS regclass)
      AND array_length(c.conkey, 1) = 1 AND c.confdeltype IN ('r', 'a')
"""


def _safe(name: str) -> str:
    if not _IDENT.match(name):
        raise ValueError(f"unsafe identifier {name!r}")
    return name


async def _delete_rows(session: AsyncSession, table: str, column: str,
                       values: list, summary: dict, seen: set, depth: int = 0) -> None:
    """Delete rows of ``table`` where ``column`` is in ``values``, children first."""
    if not values:
        return
    if depth > 12:
        raise RuntimeError(f"relationship too deep at {table}")
    table, column = _safe(table), _safe(column)
    ids = [r[0] for r in (await session.execute(
        text(f"SELECT id FROM {table} WHERE {column} = ANY(:v)"), {"v": values})).fetchall()]
    if not ids:
        return
    key = (table, tuple(sorted(map(str, ids))))
    if key in seen:
        return
    seen.add(key)
    for child, ccol, _d, notnull in (await session.execute(text(_FK_SQL), {"t": table})).fetchall():
        if notnull:
            await _delete_rows(session, child, ccol, ids, summary, seen, depth + 1)
        else:
            await session.execute(text(f"UPDATE {_safe(child)} SET {_safe(ccol)} = NULL WHERE {_safe(ccol)} = ANY(:v)"), {"v": ids})
    res = await session.execute(text(f"DELETE FROM {table} WHERE id = ANY(:v)"), {"v": ids})
    summary[table] = summary.get(table, 0) + (res.rowcount or 0)


async def purge_user(session: AsyncSession, user_id: uuid.UUID, admin_id: uuid.UUID) -> dict[str, int]:
    """Remove the user and their data. Returns {table: rows_deleted}."""
    summary: dict[str, int] = {}
    seen: set = set()
    for table, column, _d, notnull in (await session.execute(text(_FK_SQL), {"t": "users"})).fetchall():
        table, column = _safe(table), _safe(column)
        if not notnull:
            await session.execute(text(f"UPDATE {table} SET {column} = NULL WHERE {column} = :u"), {"u": user_id})
        elif column in _AUDIT_COLS:
            await session.execute(text(f"UPDATE {table} SET {column} = :a WHERE {column} = :u"), {"a": admin_id, "u": user_id})
        else:
            await _delete_rows(session, table, column, [user_id], summary, seen)
    res = await session.execute(text("DELETE FROM users WHERE id = :u"), {"u": user_id})
    summary["users"] = res.rowcount or 0
    return summary
