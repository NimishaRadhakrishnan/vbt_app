"""
Targets, KPI & Incentive - admin endpoints (phase 3). Admin only.

Thin on purpose: validation and every write (with its change-history row)
live in application/use_cases/kpi_admin.py and kpi_excel.py.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.use_cases import kpi_admin as adm
from app.application.use_cases import kpi_excel as xl
from app.domain.value_objects.role import Role
from app.presentation.api.v1.dependencies import CurrentUser, require_role
from app.infrastructure.database.session import get_db_session

router = APIRouter(prefix="/kpi/admin", tags=["Targets & Incentive (admin)"],
                   dependencies=[Depends(require_role(Role.ADMIN))])
Session = Annotated[AsyncSession, Depends(get_db_session)]
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MAX_UPLOAD = 5 * 1024 * 1024


def _bad(e: Exception) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


# ---------- request bodies
class GoalCell(BaseModel):
    officer_id: uuid.UUID
    code: str
    year: int
    month: int = Field(ge=1, le=12)
    value: float = Field(ge=0)


class SaveGoals(BaseModel):
    cells: list[GoalCell] = Field(max_length=2000)
    reason: Optional[str] = None


class SplitYearly(BaseModel):
    code: str
    fy_year: int
    yearly_value: float = Field(ge=0)
    officer_ids: list[uuid.UUID] = []
    region_id: Optional[uuid.UUID] = None
    reason: Optional[str] = None


class CopyLastYear(BaseModel):
    months: str
    officer_ids: Optional[list[uuid.UUID]] = None
    overwrite: bool = False
    reason: Optional[str] = None


class ApplyRegion(BaseModel):
    source_officer_id: uuid.UUID
    region_id: uuid.UUID
    months: str
    reason: Optional[str] = None


class MonthWeights(BaseModel):
    weights: list[dict]
    reason: Optional[str] = None


class RulesBody(BaseModel):
    effective_from: date
    reason: Optional[str] = None
    weights: Optional[list[dict]] = None
    levels: Optional[list[dict]] = None
    entry_min_sales_pct: Optional[float] = None
    level_gap: Optional[int] = None
    grades: Optional[list[dict]] = None


class SettingsBody(BaseModel):
    values: dict[str, Any]
    reason: Optional[str] = None


class SalesRow(BaseModel):
    officer_id: uuid.UUID
    year: int
    month: int = Field(ge=1, le=12)
    sales: float = Field(ge=0)
    collection: float = Field(ge=0)


class SalesBody(BaseModel):
    rows: list[SalesRow] = Field(max_length=2000)
    reason: Optional[str] = None


class FocusBody(BaseModel):
    on: date
    product_id: uuid.UUID
    officer_ids: list[uuid.UUID]
    expected: float = Field(ge=0)
    unit: str = "rupees"
    reason: Optional[str] = None


async def _guard(coro):
    try:
        return await coro
    except adm.KpiAdminError as e:
        raise _bad(e)


async def _upload(file: UploadFile) -> bytes:
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File is larger than 5 MB.")
    return data


# ---------- reference data
@router.get("/officers")
async def officers(s: Session):
    return await adm.list_officers(s)


@router.get("/items")
async def items(s: Session):
    return await adm.list_items(s)


@router.get("/products")
async def products(s: Session):
    return await adm.list_products(s)


# ---------- goals
@router.get("/goals")
async def goals(s: Session, months: str = Query(..., description="e.g. 2026-10,2026-11,2026-12")):
    return await _guard(adm.get_goals(s, adm.parse_months(months)))


@router.put("/goals")
async def put_goals(body: SaveGoals, s: Session, user: CurrentUser):
    return await _guard(adm.save_goals(s, user.user_id, [c.model_dump() for c in body.cells], body.reason))


@router.post("/goals/split-yearly")
async def split_yearly(body: SplitYearly, s: Session, user: CurrentUser):
    return await _guard(adm.split_yearly(s, user.user_id, body.code, body.fy_year, body.yearly_value,
                                         body.officer_ids, body.region_id, body.reason))


@router.post("/goals/copy-last-year")
async def copy_last_year(body: CopyLastYear, s: Session, user: CurrentUser):
    return await _guard(adm.copy_last_year(s, user.user_id, adm.parse_months(body.months), body.officer_ids,
                                           body.overwrite, body.reason))


@router.post("/goals/apply-to-region")
async def apply_to_region(body: ApplyRegion, s: Session, user: CurrentUser):
    return await _guard(adm.apply_to_region(s, user.user_id, body.source_officer_id, body.region_id,
                                            adm.parse_months(body.months), body.reason))


@router.get("/goals/template")
async def goals_template(s: Session, months: str = Query(...)):
    data = await _guard(xl.goals_template(s, adm.parse_months(months)))
    return Response(data, media_type=XLSX, headers={"Content-Disposition": 'attachment; filename="goals-template.xlsx"'})


@router.post("/goals/import")
async def goals_import(s: Session, user: CurrentUser, file: UploadFile = File(...),
                       dry_run: bool = Query(True), reason: Optional[str] = Query(None)):
    return await _guard(xl.import_goals(s, user.user_id, await _upload(file), dry_run, reason))


@router.get("/month-weights")
async def month_weights(s: Session, region_id: uuid.UUID, year: int):
    return await adm.get_month_weights(s, region_id, year)


@router.put("/month-weights")
async def put_month_weights(body: MonthWeights, s: Session, user: CurrentUser, region_id: uuid.UUID, year: int):
    await _guard(adm.set_month_weights(s, user.user_id, region_id, year, body.weights, body.reason))
    return await adm.get_month_weights(s, region_id, year)


# ---------- rules and settings
@router.get("/rules")
async def rules(s: Session, on: Optional[date] = None):
    return await adm.get_rules(s, on)


@router.get("/rules/preview")
async def rules_preview(s: Session, effective_from: date):
    return await adm.preview_rules(s, effective_from)


@router.put("/rules")
async def put_rules(body: RulesBody, s: Session, user: CurrentUser):
    return await _guard(adm.save_rules(s, user.user_id, body.model_dump(mode="json")))


@router.put("/settings")
async def put_settings(body: SettingsBody, s: Session, user: CurrentUser):
    return await _guard(adm.save_settings(s, user.user_id, body.values, body.reason))


# ---------- sales and collection figures
@router.get("/sales-figures")
async def sales_figures(s: Session, year: int, month: int = Query(ge=1, le=12)):
    return await adm.get_sales_figures(s, year, month)


@router.put("/sales-figures")
async def put_sales(body: SalesBody, s: Session, user: CurrentUser):
    return await _guard(adm.save_sales_figures(s, user.user_id, [r.model_dump() for r in body.rows], "manual", body.reason))


@router.get("/sales-figures/template")
async def sales_template(s: Session, year: int, month: int = Query(ge=1, le=12)):
    data = await xl.sales_template(s, year, month)
    return Response(data, media_type=XLSX, headers={"Content-Disposition": 'attachment; filename="sales-figures-template.xlsx"'})


@router.post("/sales-figures/import")
async def sales_import(s: Session, user: CurrentUser, file: UploadFile = File(...),
                       dry_run: bool = Query(True), reason: Optional[str] = Query(None)):
    return await _guard(xl.import_sales(s, user.user_id, await _upload(file), dry_run, reason))


# ---------- focus products
@router.get("/focus-products")
async def focus_products(s: Session, on: date):
    return await adm.get_focus_plan(s, on)


@router.put("/focus-products")
async def put_focus(body: FocusBody, s: Session, user: CurrentUser):
    return await _guard(adm.save_focus_plan(s, user.user_id, body.on, body.product_id, body.officer_ids,
                                            body.expected, body.unit, body.reason))


@router.delete("/focus-products/{plan_id}", status_code=204)
async def delete_focus(plan_id: uuid.UUID, s: Session, user: CurrentUser, reason: Optional[str] = None):
    await _guard(adm.delete_focus_plan(s, user.user_id, plan_id, reason))
    return Response(status_code=204)


# ---------- change history
@router.get("/history")
async def history(s: Session, entity: Optional[str] = None, officer_id: Optional[uuid.UUID] = None,
                  limit: int = Query(100, le=500)):
    return await adm.history(s, entity, officer_id, limit)
