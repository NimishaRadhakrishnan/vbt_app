"""
Excel templates and imports for goals and sales/collection figures.

Import is stateless and two-step: upload with dry_run=true to get a check
screen (every row marked new / changed / same / error, nothing saved), then
upload the same file with dry_run=false to save the rows that passed.
Rows are matched by Employee ID, never by name.
"""

from __future__ import annotations

import io
import uuid
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.use_cases import kpi_admin as adm

HEAD = PatternFill("solid", fgColor="DCEFE0")
MAX_ROWS = 5000


def _sheet(ws, headers: list[str], widths: list[int]) -> None:
    ws.append(headers)
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[chr(64 + i)].width = w
    for c in ws[1]:
        c.font = Font(bold=True)
        c.fill = HEAD
    ws.freeze_panes = "A2"


def _to_bytes(wb: Workbook) -> bytes:
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def goals_template(s: AsyncSession, months: list[tuple[int, int]]) -> bytes:
    officers = [o for o in await adm.list_officers(s) if o["employee_id"]]
    items = [i for i in await adm.list_items(s) if i["has_goal"]]
    current = {(g["officer_id"], g["code"], g["year"], g["month"]): g["value"] for g in await adm.get_goals(s, months)}
    wb = Workbook()
    ws = wb.active
    ws.title = "Goals"
    _sheet(ws, ["Employee ID", "Officer", "Item code", "Item", "Year", "Month", "Goal"], [14, 26, 18, 26, 8, 8, 16])
    for o in officers:
        for it in items:
            if not adm._item_applies(it["code"], o["work_mode"]):
                continue
            for (y, m) in months:
                v = current.get((o["id"], it["code"], y, m))
                ws.append([o["employee_id"], o["name"], it["code"],
                           f"{it['name']} ({it['unit_label']})" if it["unit_label"] else it["name"], y, m, v])
    help_ws = wb.create_sheet("How to fill")
    for line in [
        "Fill only the Goal column. Leave a Goal blank to keep what is saved.",
        "Sales goal and Money collected are in rupees. Trial to paid is a percentage (0 to 100).",
        "Do not change Employee ID, Item code, Year or Month - rows are matched on them.",
        "Upload the file on the Goals page; you will see a check screen before anything is saved.",
    ]:
        help_ws.append([line])
    help_ws.column_dimensions["A"].width = 100
    return _to_bytes(wb)


async def sales_template(s: AsyncSession, year: int, month: int) -> bytes:
    officers = [o for o in await adm.list_officers(s) if o["employee_id"] and o["work_mode"] in ("sales", "both")]
    current = {f["officer_id"]: f for f in await adm.get_sales_figures(s, year, month)}
    wb = Workbook()
    ws = wb.active
    ws.title = "Sales"
    _sheet(ws, ["Employee ID", "Officer", "Year", "Month", "Sales (₹)", "Money collected (₹)"], [14, 26, 8, 8, 18, 22])
    for o in officers:
        cur = current.get(o["id"])
        ws.append([o["employee_id"], o["name"], year, month, cur["sales"] if cur else None,
                   cur["collection"] if cur else None])
    return _to_bytes(wb)


def _rows(data: bytes, sheet: str) -> list[tuple[int, list[Any]]]:
    try:
        wb = load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    except Exception:
        raise adm.KpiAdminError("That file could not be opened. Please upload the .xlsx template.")
    ws = wb[sheet] if sheet in wb.sheetnames else wb.worksheets[0]
    out = []
    for n, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if n > MAX_ROWS + 1:
            raise adm.KpiAdminError(f"Too many rows (limit {MAX_ROWS}).")
        if row is None or all(c is None or str(c).strip() == "" for c in row):
            continue
        out.append((n, list(row)))
    return out


def _num(v: Any) -> Optional[Decimal]:
    if v is None or str(v).strip() == "":
        return None
    try:
        return Decimal(str(v).replace(",", "").strip())
    except InvalidOperation:
        raise ValueError(f"'{v}' is not a number")


async def _by_employee(s: AsyncSession) -> dict[str, dict]:
    return {str(o["employee_id"]).strip().lower(): o for o in await adm.list_officers(s) if o["employee_id"]}


async def import_goals(s: AsyncSession, user_id: uuid.UUID, data: bytes, dry_run: bool, reason: Optional[str]) -> dict:
    officers = await _by_employee(s)
    valid_items = set(adm.GOAL_CODES)
    out, to_save = [], []
    current: dict[tuple, float] = {}
    for n, r in _rows(data, "Goals"):
        emp, _name, code, _item, year, month, goal = (list(r) + [None] * 7)[:7]
        entry = {"row": n, "employee_id": emp, "item": code, "year": year, "month": month, "new": None, "old": None}
        try:
            o = officers.get(str(emp or "").strip().lower())
            if not o:
                raise ValueError("Employee ID not found among active field officers")
            if code not in valid_items:
                raise ValueError(f"'{code}' is not a goal item")
            if not adm._item_applies(code, o["work_mode"]):
                raise ValueError(f"{o['name']} works in {o['work_mode']} mode - this item does not apply")
            y, m = int(year), int(month)
            val = _num(goal)
            entry["officer"] = o["name"]
            if val is None:
                entry["status"] = "skipped"
                out.append(entry)
                continue
            adm.to_storage(code, val)      # range check (negative, percent > 100)
            key = (o["id"], code, y, m)
            if key not in current:
                for g in await adm.get_goals(s, [(y, m)]):
                    current[(g["officer_id"], g["code"], g["year"], g["month"])] = g["value"]
            old = current.get(key)
            entry.update(old=old, new=float(val))
            entry["status"] = "same" if old is not None and abs(old - float(val)) < 1e-9 else ("changed" if old is not None else "new")
            if entry["status"] != "same":
                to_save.append({"officer_id": o["id"], "code": code, "year": y, "month": m, "value": val})
        except (ValueError, adm.KpiAdminError, TypeError) as e:
            entry["status"] = "error"
            entry["error"] = str(e)
        out.append(entry)
    result = _summary(out)
    if not dry_run:
        if result["errors"]:
            raise adm.KpiAdminError(f"{result['errors']} row(s) have problems. Fix them and upload again - nothing was saved.")
        result["saved"] = await adm.save_goals(s, user_id, to_save, reason or "Excel import")
    result["rows"] = out
    return result


async def import_sales(s: AsyncSession, user_id: uuid.UUID, data: bytes, dry_run: bool, reason: Optional[str]) -> dict:
    officers = await _by_employee(s)
    out, to_save = [], []
    for n, r in _rows(data, "Sales"):
        emp, _name, year, month, sales, coll = (list(r) + [None] * 6)[:6]
        entry = {"row": n, "employee_id": emp, "year": year, "month": month, "sales": None, "collection": None}
        try:
            o = officers.get(str(emp or "").strip().lower())
            if not o:
                raise ValueError("Employee ID not found among active field officers")
            y, m = int(year), int(month)
            s_val, c_val = _num(sales), _num(coll)
            entry["officer"] = o["name"]
            if s_val is None and c_val is None:
                entry["status"] = "skipped"
                out.append(entry)
                continue
            if s_val is None or c_val is None:
                raise ValueError("Enter both Sales and Money collected (use 0 if nothing)")
            adm.to_storage("sales_done", s_val)
            adm.to_storage("money_collected", c_val)
            cur = next((f for f in await adm.get_sales_figures(s, y, m) if f["officer_id"] == o["id"]), None)
            entry.update(sales=float(s_val), collection=float(c_val),
                         old={"sales": cur["sales"], "collection": cur["collection"]} if cur else None)
            same = cur and cur["sales"] == float(s_val) and cur["collection"] == float(c_val)
            entry["status"] = "same" if same else ("changed" if cur else "new")
            if not same:
                to_save.append({"officer_id": o["id"], "year": y, "month": m, "sales": s_val, "collection": c_val})
        except (ValueError, adm.KpiAdminError, TypeError) as e:
            entry["status"] = "error"
            entry["error"] = str(e)
        out.append(entry)
    result = _summary(out)
    if not dry_run:
        if result["errors"]:
            raise adm.KpiAdminError(f"{result['errors']} row(s) have problems. Fix them and upload again - nothing was saved.")
        result["saved"] = await adm.save_sales_figures(s, user_id, to_save, "import", reason or "Excel import")
    result["rows"] = out
    return result


def _summary(rows: list[dict]) -> dict:
    count = lambda st: sum(1 for r in rows if r["status"] == st)
    return {"new": count("new"), "changed": count("changed"), "same": count("same"),
            "skipped": count("skipped"), "errors": count("error"), "total": len(rows)}
