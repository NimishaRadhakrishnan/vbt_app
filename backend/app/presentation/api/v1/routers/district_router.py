"""Admin-managed districts.

GET /districts is read by every officer form (web + mobile) so the district
chips always match what the admin configured. Admin add / rename / delete
live under /admin/districts. Visit and closure records store the district
NAME as text, so renaming or deleting a district never alters old records.
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.dto.auth_dto import CurrentUserOutput
from app.domain.value_objects.role import Role
from app.infrastructure.database.session import get_db_session
from app.presentation.api.v1.dependencies import CurrentUser, require_role

router = APIRouter(tags=["districts"])

DB = Annotated[AsyncSession, Depends(get_db_session)]
Admin = Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))]


class DistrictBody(BaseModel):
    name: str = Field(min_length=1, max_length=100)


@router.get("/districts")
async def list_districts(_user: CurrentUser, session: DB) -> list[dict]:
    rows = await session.execute(text("SELECT id, name FROM districts ORDER BY sort_order, name"))
    return [{"id": str(r.id), "name": r.name} for r in rows.all()]


@router.post("/admin/districts", status_code=status.HTTP_201_CREATED)
async def add_district(body: DistrictBody, _admin: Admin, session: DB) -> dict:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="District name is required.")
    dup = await session.execute(text("SELECT 1 FROM districts WHERE lower(name) = lower(:n)"), {"n": name})
    if dup.first():
        raise HTTPException(status_code=409, detail="That district already exists.")
    new_id = uuid.uuid4()
    await session.execute(
        text("INSERT INTO districts (id, name, sort_order) VALUES (:id, :n, COALESCE((SELECT MAX(sort_order) FROM districts), 0) + 1)"),
        {"id": new_id, "n": name},
    )
    await session.commit()
    return {"id": str(new_id), "name": name}


@router.put("/admin/districts/{district_id}")
async def rename_district(district_id: uuid.UUID, body: DistrictBody, _admin: Admin, session: DB) -> dict:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="District name is required.")
    dup = await session.execute(
        text("SELECT 1 FROM districts WHERE lower(name) = lower(:n) AND id <> :id"), {"n": name, "id": district_id}
    )
    if dup.first():
        raise HTTPException(status_code=409, detail="That district already exists.")
    res = await session.execute(text("UPDATE districts SET name = :n WHERE id = :id"), {"n": name, "id": district_id})
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="District not found.")
    await session.commit()
    return {"id": str(district_id), "name": name}


@router.delete("/admin/districts/{district_id}")
async def delete_district(district_id: uuid.UUID, _admin: Admin, session: DB) -> dict:
    res = await session.execute(text("DELETE FROM districts WHERE id = :id"), {"id": district_id})
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="District not found.")
    await session.commit()
    return {"deleted": True}
