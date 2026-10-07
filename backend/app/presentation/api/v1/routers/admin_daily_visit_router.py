"""
Admin Daily Visit Reports router (sections 29-31 of the spec).

Three endpoints:
- GET /admin/daily-visits          - filtered/searchable/paginated list
- GET /admin/daily-visits/{id}     - the complete record for one visit
- GET /admin/daily-visits/export/excel        - filtered results, Excel
- GET /admin/daily-visits/{id}/export/pdf     - one visit, professional PDF

DESIGN NOTE - "Region": this schema has no separate region concept
anywhere (users have no region/district column - see the TODO already
left in the mobile wizard's Step 1 about this same gap). "Region" and
"District" filters are therefore the same filter here, applied to the
visited farmer's real district (farmers.district) - the only place
district data actually lives. Not a placeholder: this is the accurate
answer to "what does the data support today," not a guess.

The list endpoint builds its WHERE clause dynamically from whichever
filters are actually supplied, so any combination works together (the
spec's own example: August + Coimbatore + Santhosh + Tomato + Trial=Yes)
without a combinatorial explosion of hand-written query variants.
"""

from __future__ import annotations

import io
import uuid
from datetime import date, datetime
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from pydantic import BaseModel
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.value_objects.role import Role
from app.infrastructure.database.session import get_db_session
from app.presentation.api.v1.dependencies import require_role

router = APIRouter(prefix="/admin/daily-visits", tags=["admin-daily-visits"])

_AdminOrManager = Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))]


class DailyVisitListItem(BaseModel):
    visit_id: uuid.UUID
    visit_date: date
    officer_name: str
    employee_id: Optional[str] = None
    district: Optional[str] = None
    village: Optional[str] = None
    farmer_name: Optional[str] = None
    crop_name: Optional[str] = None
    farming_type: Optional[str] = None
    crop_status: Optional[str] = None
    is_trial: bool
    demo_status: Optional[str] = None
    purchased: Optional[bool] = None
    conversion_status: Optional[str] = None
    order_value: Optional[float] = None


class DailyVisitListResponse(BaseModel):
    total: int
    items: list[DailyVisitListItem]


@router.get("", response_model=DailyVisitListResponse)
async def list_daily_visits(
    current_user: _AdminOrManager,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    officer_id: Optional[uuid.UUID] = None,
    employee_id: Optional[str] = None,
    manager_id: Optional[uuid.UUID] = None,
    district: Optional[str] = None,
    village: Optional[str] = None,
    crop_category_id: Optional[uuid.UUID] = None,
    crop_id: Optional[uuid.UUID] = None,
    farming_type: Optional[str] = None,
    crop_status: Optional[str] = None,
    pest_id: Optional[uuid.UUID] = None,
    disease_id: Optional[uuid.UUID] = None,
    is_trial: Optional[bool] = None,
    demo_status: Optional[str] = None,
    purchased: Optional[bool] = None,
    conversion_status: Optional[str] = None,
    product_id: Optional[uuid.UUID] = None,
    order_value_min: Optional[float] = None,
    order_value_max: Optional[float] = None,
    q: Optional[str] = None,
    only_day_closures: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> DailyVisitListResponse:
    where_clauses: list[str] = ["1=1"]
    params: dict[str, Any] = {}

    if only_day_closures:
        # Scopes to visits that ARE a day closure record (i.e. have a
        # linked day_closures row), not every visit an officer ever
        # submitted. Without this, exporting from the Day Closure
        # Reports page would include ordinary Daily Visit Tracker
        # entries that happen to match the date/officer filters but were
        # never actually anyone's day-closure submission - a different,
        # curated subset from what that page's table shows.
        where_clauses.append(
            "EXISTS (SELECT 1 FROM day_closures dc WHERE dc.visit_id = v.id AND dc.is_deleted = false)"
        )
    if date_from:
        where_clauses.append("v.start_time::date >= :date_from")
        params["date_from"] = date_from
    if date_to:
        where_clauses.append("v.start_time::date <= :date_to")
        params["date_to"] = date_to
    if officer_id:
        where_clauses.append("v.user_id = :officer_id")
        params["officer_id"] = officer_id
    if employee_id:
        where_clauses.append("u.employee_id = :employee_id")
        params["employee_id"] = employee_id
    if manager_id:
        where_clauses.append("u.manager_id = :manager_id")
        params["manager_id"] = manager_id
    if district:
        where_clauses.append("f.district ILIKE :district")
        params["district"] = f"%{district}%"
    if village:
        where_clauses.append("f.village ILIKE :village")
        params["village"] = f"%{village}%"
    if crop_category_id:
        where_clauses.append("vcp.crop_category_id = :crop_category_id")
        params["crop_category_id"] = crop_category_id
    if crop_id:
        where_clauses.append("vcp.crop_id = :crop_id")
        params["crop_id"] = crop_id
    if farming_type:
        where_clauses.append("v.farming_type = :farming_type")
        params["farming_type"] = farming_type
    if crop_status:
        where_clauses.append("vh.crop_status = :crop_status")
        params["crop_status"] = crop_status
    if pest_id:
        where_clauses.append("EXISTS (SELECT 1 FROM visit_health_pests vhp WHERE vhp.visit_id = v.id AND vhp.pest_id = :pest_id)")
        params["pest_id"] = pest_id
    if disease_id:
        where_clauses.append("EXISTS (SELECT 1 FROM visit_health_diseases vhd WHERE vhd.visit_id = v.id AND vhd.disease_id = :disease_id)")
        params["disease_id"] = disease_id
    if is_trial is not None:
        where_clauses.append("v.is_trial = :is_trial")
        params["is_trial"] = is_trial
    if demo_status:
        where_clauses.append("vtd.demo_status = :demo_status")
        params["demo_status"] = demo_status
    if purchased is not None:
        where_clauses.append("vs.purchased = :purchased")
        params["purchased"] = purchased
    if conversion_status:
        where_clauses.append("vs.conversion_status = :conversion_status")
        params["conversion_status"] = conversion_status
    if product_id:
        where_clauses.append(
            """
            (EXISTS (SELECT 1 FROM visit_trial_products vtp WHERE vtp.visit_id = v.id AND vtp.product_id = :product_id)
             OR EXISTS (SELECT 1 FROM visit_sale_items vsi WHERE vsi.visit_id = v.id AND vsi.product_id = :product_id))
            """
        )
        params["product_id"] = product_id
    if order_value_min is not None:
        where_clauses.append("vs.order_value >= :order_value_min")
        params["order_value_min"] = order_value_min
    if order_value_max is not None:
        where_clauses.append("vs.order_value <= :order_value_max")
        params["order_value_max"] = order_value_max
    if q:
        where_clauses.append(
            """
            (f.name ILIKE :q OR f.phone ILIKE :q OR u.full_name ILIKE :q
             OR v.id::text ILIKE :q OR c.name ILIKE :q OR f.village ILIKE :q
             OR EXISTS (
                 SELECT 1 FROM visit_trial_products vtp JOIN products p ON p.id = vtp.product_id
                 WHERE vtp.visit_id = v.id AND p.name ILIKE :q
             )
             OR EXISTS (
                 SELECT 1 FROM visit_sale_items vsi JOIN products p2 ON p2.id = vsi.product_id
                 WHERE vsi.visit_id = v.id AND p2.name ILIKE :q
             ))
            """
        )
        params["q"] = f"%{q}%"

    where_sql = " AND ".join(where_clauses)

    base_from = """
        FROM visits v
        JOIN users u ON u.id = v.user_id
        LEFT JOIN farmers f ON f.id = v.farmer_id
        LEFT JOIN visit_crop_profiles vcp ON vcp.visit_id = v.id
        LEFT JOIN crops c ON c.id = vcp.crop_id
        LEFT JOIN visit_health vh ON vh.visit_id = v.id
        LEFT JOIN visit_trial_details vtd ON vtd.visit_id = v.id
        LEFT JOIN visit_sales vs ON vs.visit_id = v.id
    """

    count_result = await session.execute(text(f"SELECT COUNT(*) {base_from} WHERE {where_sql}").bindparams(**params))
    total = count_result.scalar() or 0

    list_params = {**params, "limit": limit, "offset": offset}
    list_result = await session.execute(
        text(
            f"""
            SELECT
                v.id AS visit_id, v.start_time::date AS visit_date,
                u.full_name AS officer_name, u.employee_id,
                f.district, f.village, f.name AS farmer_name,
                c.name AS crop_name, v.farming_type, vh.crop_status,
                v.is_trial, vtd.demo_status, vs.purchased, vs.conversion_status, vs.order_value
            {base_from}
            WHERE {where_sql}
            ORDER BY v.start_time DESC
            LIMIT :limit OFFSET :offset
            """
        ).bindparams(**list_params)
    )
    items = [
        DailyVisitListItem(
            visit_id=row.visit_id,
            visit_date=row.visit_date,
            officer_name=row.officer_name,
            employee_id=row.employee_id,
            district=row.district,
            village=row.village,
            farmer_name=row.farmer_name,
            crop_name=row.crop_name,
            farming_type=row.farming_type,
            crop_status=row.crop_status,
            is_trial=row.is_trial,
            demo_status=row.demo_status,
            purchased=row.purchased,
            conversion_status=row.conversion_status,
            order_value=float(row.order_value) if row.order_value is not None else None,
        )
        for row in list_result.all()
    ]
    return DailyVisitListResponse(total=total, items=items)


async def _assemble_visit_detail(visit_id: uuid.UUID, session: AsyncSession) -> Optional[dict]:
    core = await session.execute(
        text(
            """
            SELECT
                v.id, v.start_time, v.farm_size_value, v.farm_size_unit, v.farming_type,
                v.next_visit_date, v.follow_up_remarks, v.officer_remarks,
                ST_Y(v.location_start::geometry) AS lat, ST_X(v.location_start::geometry) AS lng,
                u.id AS officer_id, u.full_name AS officer_name, u.employee_id,
                mgr.full_name AS manager_name,
                f.id AS farmer_id, f.name AS farmer_name, f.phone AS farmer_phone,
                f.village, f.district
            FROM visits v
            JOIN users u ON u.id = v.user_id
            LEFT JOIN users mgr ON mgr.id = u.manager_id
            LEFT JOIN farmers f ON f.id = v.farmer_id
            WHERE v.id = :visit_id
            """
        ).bindparams(visit_id=visit_id)
    )
    row = core.first()
    if not row:
        return None

    crop_profile = (
        await session.execute(
            text(
                """
                SELECT cc.name AS crop_category, c.name AS crop_name, cv.name AS variety_name,
                       vcp.variety_text, vcp.crop_age_value, vcp.crop_age_unit, vcp.sowing_date,
                       vcp.previous_crop_text, vcp.previous_yield_value, vcp.previous_yield_unit
                FROM visit_crop_profiles vcp
                LEFT JOIN crop_categories cc ON cc.id = vcp.crop_category_id
                LEFT JOIN crops c ON c.id = vcp.crop_id
                LEFT JOIN crop_varieties cv ON cv.id = vcp.variety_id
                WHERE vcp.visit_id = :visit_id
                """
            ).bindparams(visit_id=visit_id)
        )
    ).mappings().first()

    nutrients = (
        await session.execute(text("SELECT * FROM visit_nutrients WHERE visit_id = :visit_id").bindparams(visit_id=visit_id))
    ).mappings().first()

    micronutrients = (
        await session.execute(
            text(
                """
                SELECT m.name, vm.quantity, vm.unit FROM visit_micronutrients vm
                JOIN micronutrients m ON m.id = vm.micronutrient_id WHERE vm.visit_id = :visit_id
                """
            ).bindparams(visit_id=visit_id)
        )
    ).mappings().all()

    farm_operations = (
        await session.execute(
            text(
                """
                SELECT fo.name, vfo.performed_date, vfo.remarks FROM visit_farm_operations vfo
                JOIN farm_operations fo ON fo.id = vfo.farm_operation_id WHERE vfo.visit_id = :visit_id
                """
            ).bindparams(visit_id=visit_id)
        )
    ).mappings().all()

    organic_solutions = (
        await session.execute(
            text(
                """
                SELECT os.name, vos.quantity, vos.unit, vos.application_date, vos.remarks
                FROM visit_organic_solutions vos
                JOIN organic_solutions os ON os.id = vos.organic_solution_id WHERE vos.visit_id = :visit_id
                """
            ).bindparams(visit_id=visit_id)
        )
    ).mappings().all()

    advisory = (
        await session.execute(text("SELECT * FROM visit_advisory WHERE visit_id = :visit_id").bindparams(visit_id=visit_id))
    ).mappings().first()

    health = (
        await session.execute(text("SELECT crop_status, severity FROM visit_health WHERE visit_id = :visit_id").bindparams(visit_id=visit_id))
    ).mappings().first()

    pests = (
        await session.execute(
            text("SELECT p.name FROM visit_health_pests vhp JOIN pests p ON p.id = vhp.pest_id WHERE vhp.visit_id = :visit_id")
            .bindparams(visit_id=visit_id)
        )
    ).scalars().all()

    diseases = (
        await session.execute(
            text("SELECT d.name FROM visit_health_diseases vhd JOIN diseases d ON d.id = vhd.disease_id WHERE vhd.visit_id = :visit_id")
            .bindparams(visit_id=visit_id)
        )
    ).scalars().all()

    chemicals = (
        await session.execute(
            text(
                """
                SELECT COALESCE(ch.name, vhc.chemical_name_text) AS name, vhc.quantity, vhc.frequency
                FROM visit_health_chemicals vhc LEFT JOIN chemicals ch ON ch.id = vhc.chemical_id
                WHERE vhc.visit_id = :visit_id
                """
            ).bindparams(visit_id=visit_id)
        )
    ).mappings().all()

    trial_detail = (
        await session.execute(
            text("SELECT visit_purpose, demo_status, trial_plot_size_cents FROM visit_trial_details WHERE visit_id = :visit_id")
            .bindparams(visit_id=visit_id)
        )
    ).mappings().first()

    trial_products = (
        await session.execute(
            text(
                """
                SELECT p.name AS product_name, vtp.quantity_given, vtp.quantity_leftover
                FROM visit_trial_products vtp JOIN products p ON p.id = vtp.product_id WHERE vtp.visit_id = :visit_id
                """
            ).bindparams(visit_id=visit_id)
        )
    ).mappings().all()

    sales = (
        await session.execute(text("SELECT purchased, order_value, conversion_status FROM visit_sales WHERE visit_id = :visit_id").bindparams(visit_id=visit_id))
    ).mappings().first()

    sale_items = (
        await session.execute(
            text(
                """
                SELECT p.name AS product_name, vsi.quantity, vsi.unit
                FROM visit_sale_items vsi JOIN products p ON p.id = vsi.product_id WHERE vsi.visit_id = :visit_id
                """
            ).bindparams(visit_id=visit_id)
        )
    ).mappings().all()

    photos = (
        await session.execute(text("SELECT photo_url, photo_type, created_at FROM visit_photos WHERE visit_id = :visit_id").bindparams(visit_id=visit_id))
    ).mappings().all()

    return {
        "officer": {
            "id": str(row.officer_id),
            "name": row.officer_name,
            "employee_id": row.employee_id,
            "manager": row.manager_name,
            "district": row.district,
        },
        "visit": {
            "visit_id": str(row.id),
            "date": row.start_time.date().isoformat(),
            "time": row.start_time.time().isoformat(),
            "gps": {"lat": row.lat, "lng": row.lng} if row.lat is not None else None,
            "village_block": row.village,
        },
        "farmer": {
            "id": str(row.farmer_id) if row.farmer_id else None,
            "name": row.farmer_name,
            "phone": row.farmer_phone,
            "farm_size": f"{row.farm_size_value} {row.farm_size_unit}" if row.farm_size_value else None,
        },
        "crop": {**(dict(crop_profile) if crop_profile else {}), "farming_type": row.farming_type},
        "inputs": {
            "npk": dict(nutrients) if nutrients else None,
            "micronutrients": [dict(m) for m in micronutrients],
            "farm_operations": [dict(o) for o in farm_operations],
            "organic_solutions": [dict(s) for s in organic_solutions],
            "advisory": dict(advisory) if advisory else None,
        },
        "health": {
            "status": health["crop_status"] if health else None,
            "severity": health["severity"] if health else None,
            "pests": list(pests),
            "diseases": list(diseases),
            "chemicals": [dict(c) for c in chemicals],
        },
        "trial": {
            "is_trial": bool(trial_detail or trial_products),
            "purpose": trial_detail["visit_purpose"] if trial_detail else None,
            "demo_status": trial_detail["demo_status"] if trial_detail else None,
            "plot_size_cents": float(trial_detail["trial_plot_size_cents"]) if trial_detail and trial_detail["trial_plot_size_cents"] else None,
            "products": [dict(p) for p in trial_products],
        },
        "sales": dict(sales) if sales else {"purchased": False},
        "sale_items": [dict(i) for i in sale_items],
        "photos": [dict(p) for p in photos],
        "remarks": {
            "officer_remarks": row.officer_remarks,
            "follow_up_date": row.next_visit_date.isoformat() if row.next_visit_date else None,
            "follow_up_remarks": row.follow_up_remarks,
        },
    }


@router.get("/{visit_id}")
async def get_daily_visit_detail(
    visit_id: uuid.UUID,
    current_user: _AdminOrManager,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    detail = await _assemble_visit_detail(visit_id, session)
    if detail is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Visit not found.")
    return detail


# --- Exports (sections 32/33) - reuse the same openpyxl/reportlab
# libraries and StreamingResponse pattern already used in
# report_use_case.py/report_router.py, not a second export system. ---

_EXCEL_HEADERS = [
    "Visit ID", "Date", "Officer", "Employee ID", "Manager", "District", "Village",
    "Farmer", "Contact", "Farm Size", "Crop Category", "Crop", "Variety", "Farming Type",
    "Crop Age", "Planting Date", "Previous Crop", "Previous Yield",
    "NPK", "Micronutrients", "Operations", "Organic/IPM", "Advisory",
    "Crop Status", "Pest", "Disease", "Chemicals", "Severity",
    "Trial", "Demo Purpose", "Demo Status", "Trial Plot Size", "Trial Products", "Trial Quantity", "Remaining Quantity",
    "Purchased", "Products Bought", "Order Value", "Conversion Status",
    "Follow-up Date", "Remarks",
]


def _join(values: list[str]) -> str:
    # Section 32: "represent multiple values cleanly in the Excel cell" -
    # comma-joined in one cell, not duplicated rows per value.
    return ", ".join(v for v in values if v) or ""


@router.get("/export/excel")
async def export_daily_visits_excel(
    current_user: _AdminOrManager,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    officer_id: Optional[uuid.UUID] = None,
    employee_id: Optional[str] = None,
    manager_id: Optional[uuid.UUID] = None,
    district: Optional[str] = None,
    village: Optional[str] = None,
    crop_category_id: Optional[uuid.UUID] = None,
    crop_id: Optional[uuid.UUID] = None,
    farming_type: Optional[str] = None,
    crop_status: Optional[str] = None,
    pest_id: Optional[uuid.UUID] = None,
    disease_id: Optional[uuid.UUID] = None,
    is_trial: Optional[bool] = None,
    demo_status: Optional[str] = None,
    purchased: Optional[bool] = None,
    conversion_status: Optional[str] = None,
    product_id: Optional[uuid.UUID] = None,
    order_value_min: Optional[float] = None,
    order_value_max: Optional[float] = None,
    q: Optional[str] = None,
    only_day_closures: bool = False,
) -> StreamingResponse:
    # Reuses the exact same filter set/logic as list_daily_visits (same
    # function, called directly) so "export only what's filtered" (section
    # 32) is guaranteed to match what the admin is actually looking at -
    # not a second, potentially-drifting filter implementation. Capped at
    # 5000 rows for one export - large enough for any realistic filtered
    # set, without an unbounded query backing a file download.
    listing = await list_daily_visits(
        current_user=current_user, session=session, date_from=date_from, date_to=date_to,
        officer_id=officer_id, employee_id=employee_id, manager_id=manager_id, district=district,
        village=village, crop_category_id=crop_category_id, crop_id=crop_id, farming_type=farming_type,
        crop_status=crop_status, pest_id=pest_id, disease_id=disease_id, is_trial=is_trial,
        demo_status=demo_status, purchased=purchased, conversion_status=conversion_status,
        product_id=product_id, order_value_min=order_value_min, order_value_max=order_value_max,
        q=q, only_day_closures=only_day_closures, limit=5000, offset=0,
    )

    wb = Workbook()
    ws = wb.active
    ws.title = "Daily Visit Reports"
    ws.append(_EXCEL_HEADERS)

    for item in listing.items:
        detail = await _assemble_visit_detail(item.visit_id, session)
        if detail is None:
            continue
        crop = detail["crop"]
        inputs = detail["inputs"]
        health = detail["health"]
        trial = detail["trial"]
        remarks = detail["remarks"]
        ws.append([
            str(item.visit_id), item.visit_date.isoformat(), item.officer_name, item.employee_id,
            detail["officer"]["manager"], item.district, item.village,
            item.farmer_name, detail["farmer"]["phone"], detail["farmer"]["farm_size"],
            crop.get("crop_category"), crop.get("crop_name"), crop.get("variety_name") or crop.get("variety_text"),
            item.farming_type,
            f"{crop.get('crop_age_value')} {crop.get('crop_age_unit')}" if crop.get("crop_age_value") else "",
            crop.get("sowing_date").isoformat() if crop.get("sowing_date") else "",
            crop.get("previous_crop_text"),
            f"{crop.get('previous_yield_value')} {crop.get('previous_yield_unit')}" if crop.get("previous_yield_value") else "",
            f"N:{inputs['npk']['n_qty']} P:{inputs['npk']['p_qty']} K:{inputs['npk']['k_qty']}" if inputs.get("npk") else "",
            _join([f"{m['name']} ({m['quantity']}{m['unit'] or ''})" for m in inputs["micronutrients"]]),
            _join([o["name"] for o in inputs["farm_operations"]]),
            _join([s["name"] for s in inputs["organic_solutions"]]),
            "Yes" if inputs.get("advisory") and inputs["advisory"].get("used_advisory") else "No",
            item.crop_status, _join(health["pests"]), _join(health["diseases"]),
            _join([c["name"] for c in health["chemicals"]]), health.get("severity"),
            "Yes" if item.is_trial else "No", trial.get("purpose"), trial.get("demo_status"),
            trial.get("plot_size_cents"),
            _join([p["product_name"] for p in trial["products"]]),
            _join([str(p["quantity_given"]) for p in trial["products"]]),
            _join([str(p["quantity_leftover"]) for p in trial["products"]]),
            "Yes" if item.purchased else "No",
            _join([i["product_name"] for i in detail["sale_items"]]),
            item.order_value, item.conversion_status,
            remarks.get("follow_up_date"), remarks.get("officer_remarks"),
        ])

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=daily_visit_reports_{datetime.utcnow().date()}.xlsx"},
    )


@router.get("/{visit_id}/export/pdf")
async def export_daily_visit_pdf(
    visit_id: uuid.UUID,
    current_user: _AdminOrManager,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> StreamingResponse:
    detail = await _assemble_visit_detail(visit_id, session)
    if detail is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Visit not found.")

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, rightMargin=36, leftMargin=36, topMargin=36, bottomMargin=36)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        name="TitleStyle", parent=styles["Heading1"], fontName="Helvetica-Bold",
        fontSize=16, textColor=colors.HexColor("#1b5e20"), spaceAfter=6,
    )
    section_style = ParagraphStyle(
        name="SectionStyle", parent=styles["Heading2"], fontName="Helvetica-Bold",
        fontSize=12, textColor=colors.HexColor("#1b5e20"), spaceBefore=12, spaceAfter=4,
    )
    body_style = styles["BodyText"]

    story: list = [
        Paragraph("Vishakan Biotech - Daily Visit Report", title_style),
        Paragraph(f"Visit ID: {detail['visit']['visit_id']}", body_style),
        Paragraph(f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}", body_style),
        Spacer(1, 10),
    ]

    def add_section(title: str, rows: list[tuple[str, Any]]) -> None:
        # Section-per-section tables, not one giant table (section 33's
        # explicit "do not squeeze every field into an unreadable single
        # table" instruction).
        visible = [(label, str(value)) for label, value in rows if value not in (None, "", [])]
        if not visible:
            return
        story.append(Paragraph(title, section_style))
        table = Table(visible, colWidths=[140, 340])
        table.setStyle(TableStyle([
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#555555")),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("LINEBELOW", (0, 0), (-1, -1), 0.5, colors.HexColor("#eeeeee")),
        ]))
        story.append(table)

    add_section("Officer", list(detail["officer"].items()))
    add_section("Visit", [
        ("Date", detail["visit"]["date"]), ("Time", detail["visit"]["time"]),
        ("Village/Block", detail["visit"]["village_block"]),
        ("GPS", f"{detail['visit']['gps']['lat']}, {detail['visit']['gps']['lng']}" if detail["visit"]["gps"] else None),
    ])
    add_section("Farmer", list(detail["farmer"].items()))
    add_section("Crop", list(detail["crop"].items()))
    add_section("Practices & Inputs", [
        ("NPK", detail["inputs"]["npk"]),
        ("Micronutrients", _join([f"{m['name']} ({m['quantity']}{m['unit'] or ''})" for m in detail["inputs"]["micronutrients"]])),
        ("Operations", _join([o["name"] for o in detail["inputs"]["farm_operations"]])),
        ("Organic/IPM", _join([s["name"] for s in detail["inputs"]["organic_solutions"]])),
    ])
    add_section("Crop Health", [
        ("Status", detail["health"]["status"]), ("Severity", detail["health"]["severity"]),
        ("Pest", _join(detail["health"]["pests"])), ("Disease", _join(detail["health"]["diseases"])),
        ("Chemicals", _join([c["name"] for c in detail["health"]["chemicals"]])),
    ])
    add_section("Trial / Demo", [
        ("Purpose", detail["trial"]["purpose"]), ("Status", detail["trial"]["demo_status"]),
        ("Plot Size (cents)", detail["trial"]["plot_size_cents"]),
        ("Products", _join([f"{p['product_name']} (given {p['quantity_given']}, left {p['quantity_leftover']})" for p in detail["trial"]["products"]])),
    ])
    add_section("Sales", [
        ("Purchased", "Yes" if detail["sales"].get("purchased") else "No"),
        ("Order Value", detail["sales"].get("order_value")),
        ("Conversion Status", detail["sales"].get("conversion_status")),
        ("Products Bought", _join([f"{i['product_name']} x{i['quantity']}" for i in detail["sale_items"]])),
    ])
    add_section("Remarks", list(detail["remarks"].items()))

    if detail["photos"]:
        story.append(Paragraph("Photos", section_style))
        story.append(Paragraph(f"{len(detail['photos'])} photo(s) attached to this visit - see the web record for images.", body_style))
        # NOTE: embedding the actual images would need the photo URLs to
        # be reachable as local files or fetched over HTTP from inside
        # this PDF-generation code - not done in this pass since it turns
        # a synchronous ReportLab build into a network-dependent one.
        # Flagged rather than silently only listing a count.

    doc.build(story)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=visit_report_{visit_id}.pdf"},
    )
