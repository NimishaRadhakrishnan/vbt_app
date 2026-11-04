"""
Incentive statements (phase 5): close / reopen a quarter, approve, mark paid,
the step-by-step breakdown, Excel and PDF export, and the team overview.

A statement is frozen at close: it stores every input, the rule version and
the result, so numbers never change afterwards. The breakdown shown on
screen, in Excel and in the PDF is built from that frozen copy by one
function (`breakdown`), so the three always agree. Corrections need Reopen
with a reason (saved in the change history), then close again.
"""

from __future__ import annotations

import io
import json
import uuid
from datetime import date
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.use_cases import kpi_recalculate as eng
from app.application.use_cases.kpi_admin import audit
from app.infrastructure.config.company_time import company_today
from app.infrastructure.repositories import kpi_data_repository as repo


class StatementError(ValueError):
    """A plain-words reason shown to the admin."""


STATUS_LABEL = {"draft": "Draft", "approved": "Approved", "paid": "Paid"}


# ------------------------------------------------------------------ helpers


def inr(paise: Optional[int]) -> str:
    if paise is None:
        return "–"
    n = int(round(paise / 100))
    s = str(abs(n))
    if len(s) > 3:
        head, tail, parts = s[:-3], s[-3:], []
        while len(head) > 2:
            parts.insert(0, head[-2:]); head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts + [tail])
    return ("-" if n < 0 else "") + "₹" + s


def pct(v: Any) -> str:
    return "–" if v is None else f"{float(v) * 100:.1f}%"


async def _period(s: AsyncSession, period_id: uuid.UUID) -> dict:
    r = (await s.execute(text("SELECT id, type, start_date, end_date, status FROM kpi_period WHERE id = :i"),
                         {"i": period_id})).first()
    if r is None:
        raise StatementError("That period does not exist.")
    return {"id": r.id, "type": r.type, "start": r.start_date, "end": r.end_date, "status": r.status}


async def team_ids(s: AsyncSession, viewer) -> list[uuid.UUID]:
    """Admin: every active field officer. Manager: their own team. Anyone else: nobody."""
    if viewer.role == "admin":
        q, p = "SELECT id FROM users WHERE role = 'field_officer' AND is_active = true AND is_deleted = false", {}
    elif viewer.role == "manager":
        q = ("SELECT id FROM users WHERE role = 'field_officer' AND is_active = true AND is_deleted = false "
             "AND manager_id = :m")
        p = {"m": viewer.user_id}
    else:
        return []
    return [r.id for r in (await s.execute(text(q), p)).all()]


async def periods(s: AsyncSession) -> list[dict]:
    rows = (await s.execute(text(
        "SELECT p.id, p.type, p.start_date, p.end_date, p.status, "
        "(SELECT count(*) FROM incentive_statement st WHERE st.period_id = p.id) AS statements "
        "FROM kpi_period p WHERE p.type = 'quarter' ORDER BY p.start_date DESC LIMIT 12"))).all()
    return [{"id": str(r.id), "start": r.start_date, "end": r.end_date, "status": r.status,
             "statements": r.statements, "finished": r.end_date < company_today()} for r in rows]


# -------------------------------------------------------------- the list


async def list_statements(s: AsyncSession, viewer, period_id: uuid.UUID) -> dict:
    period = await _period(s, period_id)
    ids = await team_ids(s, viewer)
    closed = period["status"] == "closed"
    rows = (await s.execute(text("""
        SELECT u.id, u.full_name, u.employee_id, u.work_mode,
               ps.score, ps.grade, ps.sales_level, ps.collection_level, ps.level_match_applied,
               ps.final_incentive_paise, ps.waiting_for_figures,
               st.id AS st_id, st.status, st.final_amount_paise, st.paid_on, st.inputs
        FROM users u
        LEFT JOIN LATERAL (SELECT * FROM performance_snapshot x WHERE x.officer_id = u.id AND x.period_id = :p
                           ORDER BY snapshot_date DESC LIMIT 1) ps ON true
        LEFT JOIN incentive_statement st ON st.officer_id = u.id AND st.period_id = :p
        WHERE u.id = ANY(:ids) ORDER BY u.full_name
    """), {"p": period_id, "ids": ids})).all()
    out, total = [], 0
    for r in rows:
        if r.st_id is not None:                    # frozen figures
            inc = ((r.inputs or {}).get("snapshot") or {}).get("sales", {}).get("incentive") or {}
            amount = r.final_amount_paise
            sl, cl = inc.get("sales_level"), inc.get("collection_level")
            lm = bool(inc.get("level_match_applied"))
            status = r.status
        else:                                      # still open: live figures
            amount, sl, cl, lm = r.final_incentive_paise, r.sales_level, r.collection_level, bool(r.level_match_applied)
            status = "draft"
        if amount:
            total += amount
        out.append({
            "officer_id": str(r.id), "name": r.full_name, "employee_id": r.employee_id, "work_mode": r.work_mode,
            "statement_id": str(r.st_id) if r.st_id else None,
            "sales_level": sl, "collection_level": cl, "level_match_applied": lm,
            "score": float(r.score) if r.score is not None else None, "grade": r.grade,
            "final_paise": amount, "waiting_for_figures": bool(r.waiting_for_figures),
            "status": status, "status_label": STATUS_LABEL[status], "paid_on": r.paid_on,
            "has_incentive": r.work_mode != "field",
        })
    return {"period": {**period, "id": str(period["id"]), "closed": closed, "finished": period["end"] < company_today()},
            "rows": out, "total_paise": total,
            "all_approved": bool(out) and all(x["status"] != "draft" for x in out if x["statement_id"])}


# ---------------------------------------------------------- the breakdown


def breakdown(inputs: dict, status: str, paid_on: Any = None) -> dict:
    """Step-by-step, same order as the Excel sheet accounts already use."""
    snap, rules = inputs["snapshot"], inputs["rules"]
    names = inputs.get("item_names", {})
    o, p = inputs["officer"], inputs["period"]
    lv = {x["level"]: x for x in rules["levels"]}
    sections: list[dict] = [{"title": "Officer and period", "rows": [
        ["Officer", f"{o['name']}" + (f" ({o['employee_id']})" if o.get("employee_id") else "")],
        ["Work mode", {"field": "Field", "sales": "Sales", "both": "Both"}.get(o["mode"], o["mode"])],
        ["Period", f"{p['start']} to {p['end']}"],
        ["Rules in force from", inputs.get("rule_version") or p["start"]],
        ["Status", STATUS_LABEL.get(status, status) + (f" on {paid_on}" if status == "paid" and paid_on else "")],
    ]}]
    sales = snap.get("sales")
    if sales and not sales.get("waiting_for_figures") and sales.get("incentive"):
        i = sales["incentive"]
        sg, cg = sales["sales_goal_paise"], sales["collection_goal_paise"]
        sections.append({"title": "Step 1 · Sales and collection against goal", "rows": [
            ["Sales goal", inr(sg)], ["Sales done", inr(sales["sales_paise"])], ["Sales done %", pct(i["sales_pct"])],
            ["Collection goal (sales goal if none set)", inr(cg)], ["Money collected", inr(sales["collection_paise"])],
            ["Collection done %", pct(i["collection_pct"])]]})
        sections.append({"title": "Step 2 · Level reached", "rows": [
            ["Sales level", str(i["raw_sales_level"])], ["Collection level", str(i["raw_collection_level"])]]})
        entry_min = rules["levels"][0]["entry_min_sales_pct"] if rules["levels"] else 0.8
        sections.append({"title": "Step 3 · Entry rule", "rows": [
            [f"Sales under {pct(entry_min)}?", "Yes - both levels become 0" if i["entry_rule_applied"] else "No"]]})
        sections.append({"title": "Step 4 · Level match rule", "rows": [
            ["Levels two or more apart?", "Yes - the higher level drops by one" if i["level_match_applied"] else "No"],
            ["Sales level used", str(i["sales_level"])], ["Collection level used", str(i["collection_level"])]]})
        sr, cr = lv.get(i["sales_level"]), lv.get(i["collection_level"])
        sections.append({"title": "Step 5 and 6 · Incentive from levels", "rows": [
            ["Sales incentive", f"{inr(sales['sales_paise'])} × {float(sr['sales_rate']) * 100:.2f}% = {inr(round(i['sales_incentive_paise']))}" if sr else "₹0"],
            ["Collection incentive", f"{inr(sales['collection_paise'])} × {float(cr['coll_rate']) * 100:.2f}% = {inr(round(i['collection_incentive_paise']))}" if cr else "₹0"],
            ["Incentive from levels", inr(round(i["level_incentive_paise"]))]]})
    elif sales and sales.get("waiting_for_figures"):
        sections.append({"title": "Sales and collection", "rows": [["Sales figures", "Not entered - no incentive could be worked out"]]})
    for key, title in (("field", "Field score"), ("sales", "Sales score")):
        part = snap.get(key)
        if not part:
            continue
        rows = [["Item", "Goal", "Done", "Done %", "Marks", "Out of"]]
        for code, it in part["items"].items():
            money = code in ("sales_done", "money_collected")
            conv = (lambda v: inr(v)) if money else (lambda v, c=code: f"{v * 100:.0f}%" if c == "trial_to_paid" else f"{v:g}")
            rows.append([names.get(code, code) + (" (Max)" if it["at_max"] else "") + (" (not counted)" if it["skipped"] else ""),
                         conv(it["goal"]), conv(it["done"]), pct(it["pct"]), f"{it['marks']:.2f}", f"{it['max_marks']:.2f}"])
        rows.append(["Total score", "", "", "", f"{part['score']:.2f}", "100"])
        sections.append({"title": f"Step 7 · {title}", "table": True, "rows": rows})
    if sales and sales.get("incentive"):
        i = sales["incentive"]
        sections.append({"title": "Step 7 and 8 · Score factor and final amount", "rows": [
            ["Score", f"{sales['score']:.2f}" + (f" (Grade {sales['grade']})" if sales.get("grade") else "")],
            ["Score factor (score ÷ 100, highest " + f"{rules['score_factor_max']:g})", f"{i['score_factor']:.4f}"],
            ["Final incentive (rounded to the rupee)", inr(i["final_paise"])]]})
    return {"sections": sections}


# ------------------------------------------------------------ close/reopen


async def _freeze_inputs(s: AsyncSession, officer: dict, period: dict, snap_row, rules_rows: dict,
                         settings: dict, names: dict) -> dict:
    return json.loads(json.dumps({
        "officer": officer, "period": {"type": period["type"], "start": period["start"], "end": period["end"]},
        "snapshot": snap_row.items, "score": snap_row.score, "grade": snap_row.grade,
        "rule_version": snap_row.rule_version,
        "rules": {
            "levels": [dict(r._mapping) for r in rules_rows["levels"]],
            "grades": [dict(r._mapping) for r in rules_rows["grades"]],
            "weights": [dict(r._mapping) for r in rules_rows["weights"]],
            "score_factor_max": float(settings.get("kpi.score_factor_max_pct", 1.2)),
        },
        "item_names": names,
    }, default=str))


async def close_period(s: AsyncSession, user_id: uuid.UUID, period_id: uuid.UUID, allow_missing: bool) -> dict:
    period = await _period(s, period_id)
    if period["type"] != "quarter":
        raise StatementError("Only a quarter can be closed.")
    if period["status"] == "closed":
        raise StatementError("This quarter is already closed. Use Reopen if it needs a correction.")
    if period["end"] >= company_today():
        raise StatementError("This quarter has not finished yet. You can close it after its last day.")

    ids = [r.id for r in (await s.execute(text(
        "SELECT id FROM users WHERE role = 'field_officer' AND is_active = true AND is_deleted = false"))).all()]
    today = company_today()
    months = [(await eng.ensure_period(s, "month", date(y, m, 1))) for y, m in repo.months_in(period["start"], period["end"])]
    # final recalculation of the quarter and its months, then a check for missing figures
    for oid in ids:
        for per in [period, *months]:
            await eng.recalculate(s, oid, per["id"], today=today)
    waiting = (await s.execute(text("""
        SELECT u.full_name FROM users u JOIN performance_snapshot ps ON ps.officer_id = u.id AND ps.period_id = :p
        WHERE ps.waiting_for_figures AND ps.snapshot_date = (SELECT max(snapshot_date) FROM performance_snapshot
                                                              WHERE officer_id = u.id AND period_id = :p)
        ORDER BY u.full_name"""), {"p": period_id})).all()
    if waiting and not allow_missing:
        names = ", ".join(r.full_name for r in waiting)
        raise StatementError(f"Sales figures are missing for: {names}. Add them, or close anyway to give these officers no incentive.")

    settings = await repo.get_settings_map(s)
    rules_rows = await repo.rules_for(s, period["start"])
    names = {r.code: r.simple_name for r in (await s.execute(text("SELECT code, simple_name FROM kpi_item"))).all()}
    made = 0
    for oid in ids:
        snap = (await s.execute(text("SELECT * FROM performance_snapshot WHERE officer_id = :o AND period_id = :p "
                                     "ORDER BY snapshot_date DESC LIMIT 1"), {"o": oid, "p": period_id})).first()
        if snap is None:
            continue
        u = (await s.execute(text("SELECT full_name, employee_id, work_mode FROM users WHERE id = :i"), {"i": oid})).one()
        inputs = await _freeze_inputs(s, {"id": str(oid), "name": u.full_name, "employee_id": u.employee_id,
                                          "mode": u.work_mode or "both"}, period, snap, rules_rows, settings, names)
        await s.execute(text("""
            INSERT INTO incentive_statement (officer_id, period_id, inputs, rule_version, final_amount_paise)
            VALUES (:o, :p, CAST(:i AS jsonb), :rv, :a)
            ON CONFLICT (officer_id, period_id) DO NOTHING"""),
            {"o": oid, "p": period_id, "i": json.dumps(inputs), "rv": snap.rule_version or period["start"],
             "a": int(snap.final_incentive_paise or 0)})
        made += 1
    for per in [period, *months]:
        await s.execute(text("UPDATE kpi_period SET status = 'closed' WHERE id = :i"), {"i": per["id"]})
    await audit(s, "statement", period_id, "close", {"status": "open"},
                {"status": "closed", "statements": made, "missing_figures": len(waiting)}, None, user_id)
    await s.commit()
    return {"closed": True, "statements": made, "missing_figures": [r.full_name for r in waiting]}


async def reopen_period(s: AsyncSession, user_id: uuid.UUID, period_id: uuid.UUID, reason: str) -> dict:
    period = await _period(s, period_id)
    if not (reason or "").strip():
        raise StatementError("Please write the reason for reopening.")
    if period["status"] != "closed":
        raise StatementError("This quarter is not closed.")
    paid = (await s.execute(text("SELECT count(*) FROM incentive_statement WHERE period_id = :p AND status = 'paid'"),
                            {"p": period_id})).scalar_one()
    if paid:
        raise StatementError(f"{paid} statement(s) are already marked Paid, so this quarter cannot be reopened.")
    old = (await s.execute(text("SELECT officer_id, final_amount_paise, status FROM incentive_statement WHERE period_id = :p"),
                           {"p": period_id})).all()
    await s.execute(text("DELETE FROM incentive_statement WHERE period_id = :p"), {"p": period_id})
    await s.execute(text("UPDATE kpi_period SET status = 'open' WHERE id = :p OR (type = 'month' AND start_date >= :a "
                         "AND end_date <= :b)"), {"p": period_id, "a": period["start"], "b": period["end"]})
    await audit(s, "statement", period_id, "reopen",
                [{"officer_id": str(r.officer_id), "final_amount_paise": r.final_amount_paise, "status": r.status} for r in old],
                {"status": "open"}, reason, user_id)
    await s.commit()
    return {"reopened": True, "statements_removed": len(old)}


# ------------------------------------------------------- approve and pay


async def approve_all(s: AsyncSession, user_id: uuid.UUID, period_id: uuid.UUID) -> dict:
    period = await _period(s, period_id)
    if period["status"] != "closed":
        raise StatementError("Close the quarter first.")
    r = await s.execute(text("""UPDATE incentive_statement SET status = 'approved', approved_by = :u, approved_at = now()
                                WHERE period_id = :p AND status = 'draft' RETURNING id"""), {"u": user_id, "p": period_id})
    n = len(r.all())
    await audit(s, "statement", period_id, "approve_all", {"status": "draft"}, {"status": "approved", "count": n}, None, user_id)
    await s.commit()
    return {"approved": n}


async def approve_one(s: AsyncSession, user_id: uuid.UUID, statement_id: uuid.UUID) -> dict:
    r = await s.execute(text("""UPDATE incentive_statement SET status = 'approved', approved_by = :u, approved_at = now()
                                WHERE id = :i AND status = 'draft' RETURNING id"""), {"u": user_id, "i": statement_id})
    if r.first() is None:
        raise StatementError("Only a Draft statement can be approved.")
    await audit(s, "statement", statement_id, "approve", {"status": "draft"}, {"status": "approved"}, None, user_id)
    await s.commit()
    return {"status": "approved"}


async def mark_paid(s: AsyncSession, user_id: uuid.UUID, statement_id: uuid.UUID, paid_on: date) -> dict:
    if paid_on > company_today():
        raise StatementError("The paid date cannot be in the future.")
    r = await s.execute(text("""UPDATE incentive_statement SET status = 'paid', paid_on = :d
                                WHERE id = :i AND status = 'approved' RETURNING id"""), {"d": paid_on, "i": statement_id})
    if r.first() is None:
        raise StatementError("Approve the statement before marking it Paid.")
    await audit(s, "statement", statement_id, "paid", {"status": "approved"}, {"status": "paid", "paid_on": paid_on}, None, user_id)
    await s.commit()
    return {"status": "paid", "paid_on": paid_on}


# --------------------------------------------------------------- detail


async def detail(s: AsyncSession, officer_id: uuid.UUID, period_id: uuid.UUID) -> dict:
    """Frozen breakdown if the quarter is closed, otherwise a live (Draft) one."""
    st = (await s.execute(text("SELECT status, paid_on, final_amount_paise, inputs FROM incentive_statement "
                               "WHERE officer_id = :o AND period_id = :p"), {"o": officer_id, "p": period_id})).first()
    if st is not None:
        return {"frozen": True, "status": st.status, "status_label": STATUS_LABEL[st.status],
                "final_paise": st.final_amount_paise, **breakdown(st.inputs, st.status, st.paid_on)}
    period = await _period(s, period_id)
    snap = (await s.execute(text("SELECT * FROM performance_snapshot WHERE officer_id = :o AND period_id = :p "
                                 "ORDER BY snapshot_date DESC LIMIT 1"), {"o": officer_id, "p": period_id})).first()
    if snap is None:
        raise StatementError("No figures yet for this officer in this period.")
    u = (await s.execute(text("SELECT full_name, employee_id, work_mode FROM users WHERE id = :i"), {"i": officer_id})).one()
    settings = await repo.get_settings_map(s)
    names = {r.code: r.simple_name for r in (await s.execute(text("SELECT code, simple_name FROM kpi_item"))).all()}
    inputs = await _freeze_inputs(s, {"id": str(officer_id), "name": u.full_name, "employee_id": u.employee_id,
                                      "mode": u.work_mode or "both"}, period, snap, await repo.rules_for(s, period["start"]),
                                  settings, names)
    return {"frozen": False, "status": "draft", "status_label": "Draft", "final_paise": int(snap.final_incentive_paise or 0),
            **breakdown(inputs, "draft")}


async def own_statement(s: AsyncSession, officer_id: uuid.UUID, period_id: uuid.UUID) -> dict:
    """An officer sees their own statement only after the admin has closed the period."""
    p = await _period(s, period_id)
    if p["status"] != "closed":
        raise StatementError("Your statement is shown after the office closes the quarter.")
    return await detail(s, officer_id, period_id)


# --------------------------------------------------------------- exports


async def _all_details(s: AsyncSession, viewer, period_id: uuid.UUID) -> tuple[dict, list[dict]]:
    lst = await list_statements(s, viewer, period_id)
    det = []
    for r in lst["rows"]:
        try:
            det.append({"row": r, **(await detail(s, uuid.UUID(r["officer_id"]), period_id))})
        except StatementError:
            continue
    return lst, det


def _label(lst: dict) -> str:
    p = lst["period"]
    return f"{p['start']} to {p['end']}"


async def export_xlsx(s: AsyncSession, viewer, period_id: uuid.UUID) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    lst, det = await _all_details(s, viewer, period_id)
    wb = Workbook()
    ws = wb.active
    ws.title = "Summary"
    ws.append([f"Incentive statements · {_label(lst)} · " + ("Closed" if lst["period"]["closed"] else "Draft (quarter still open)")])
    ws["A1"].font = Font(bold=True, size=13)
    ws.append([])
    head = ["Officer", "Employee ID", "Sales level", "Collection level", "Level match applied", "Score", "Grade",
            "Final ₹", "Status", "Paid on"]
    ws.append(head)
    for c in ws[3]:
        c.font = Font(bold=True)
        c.fill = PatternFill("solid", fgColor="DCEFE0")
    for r in lst["rows"]:
        ws.append([r["name"], r["employee_id"] or "", r["sales_level"] if r["sales_level"] is not None else "",
                   r["collection_level"] if r["collection_level"] is not None else "", "Yes" if r["level_match_applied"] else "No",
                   r["score"] if r["score"] is not None else "", r["grade"] or "",
                   (r["final_paise"] or 0) / 100 if r["has_incentive"] else "", r["status_label"],
                   str(r["paid_on"]) if r["paid_on"] else ""])
    ws.append([])
    ws.append(["Total payable", "", "", "", "", "", "", lst["total_paise"] / 100])
    ws.cell(ws.max_row, 1).font = Font(bold=True)
    for col, w in zip("ABCDEFGHIJ", (28, 14, 12, 16, 18, 8, 8, 14, 12, 12)):
        ws.column_dimensions[col].width = w
    for r in ws.iter_rows(min_row=4, min_col=8, max_col=8):
        for c in r:
            c.number_format = '"₹"#,##0'
    used: set[str] = {"Summary"}
    for d in det:
        base = "".join(ch for ch in d["row"]["name"] if ch not in '[]:*?/\\')[:28] or "Officer"
        name, k = base, 2
        while name in used:
            name = f"{base[:25]} {k}"; k += 1
        used.add(name)
        sh = wb.create_sheet(name)
        for sec in d["sections"]:
            sh.append([sec["title"]])
            sh.cell(sh.max_row, 1).font = Font(bold=True)
            for i, row in enumerate(sec["rows"]):
                sh.append(row)
                if sec.get("table") and i == 0:
                    for c in sh[sh.max_row]:
                        c.font = Font(bold=True)
            sh.append([])
        sh.column_dimensions["A"].width = 46
        for col in "BCDEF":
            sh.column_dimensions[col].width = 24
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def export_pdf(s: AsyncSession, viewer, period_id: uuid.UUID) -> bytes:
    """One page per officer, with a signature line."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    lst, det = await _all_details(s, viewer, period_id)
    ss = getSampleStyleSheet()
    story: list = []
    for n, d in enumerate(det):
        if n:
            story.append(PageBreak())
        story.append(Paragraph(f"Incentive statement · {_label(lst)}", ss["Title"]))
        for sec in d["sections"]:
            story.append(Paragraph(sec["title"], ss["Heading4"]))
            rows = [[Paragraph(str(c), ss["BodyText"]) if len(str(c)) > 40 else str(c) for c in r] for r in sec["rows"]]
            width = 180 * mm
            t = Table(rows, colWidths=None if sec.get("table") else [70 * mm, width - 70 * mm])
            style = [("FONTSIZE", (0, 0), (-1, -1), 8), ("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
                     ("VALIGN", (0, 0), (-1, -1), "TOP")]
            if sec.get("table"):
                style += [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e6f2e8")),
                          ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold")]
            t.setStyle(TableStyle(style))
            story.append(t)
        story.append(Spacer(1, 10 * mm))
        story.append(Paragraph(f"<b>Final incentive: {inr(d['final_paise'])}</b> · {d['status_label']}", ss["BodyText"]))
        story.append(Spacer(1, 14 * mm))
        sig = Table([["Officer signature: ______________________", "Approved by: ______________________"],
                     ["Date: ______________", "Date: ______________"]], colWidths=[90 * mm, 90 * mm])
        sig.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 9), ("TOPPADDING", (0, 0), (-1, -1), 8)]))
        story.append(sig)
    if not story:
        story.append(Paragraph("No statements for this quarter.", ss["BodyText"]))
    buf = io.BytesIO()
    SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=12 * mm, bottomMargin=12 * mm).build(story)
    return buf.getvalue()


# ----------------------------------------------------------- team overview

HEAT_ITEMS = ("farmers_visited", "villages_covered", "demo_agreed", "trial_area", "trial_to_paid",
              "sales_done", "focus_products", "money_collected", "dealer_health", "fo_follow_up", "daily_report")


async def team_overview(s: AsyncSession, viewer, kind: str, period_id: Optional[uuid.UUID],
                        region_id: Optional[uuid.UUID], mode: Optional[str]) -> dict:
    today = company_today()
    period = await _period(s, period_id) if period_id else await eng.ensure_period(s, kind, today)
    ids = await team_ids(s, viewer)
    meta = {r.code: r.simple_name for r in (await s.execute(text("SELECT code, simple_name FROM kpi_item"))).all()}
    rows = (await s.execute(text("""
        SELECT u.id, u.full_name, u.work_mode,
               coalesce((SELECT min(t.name) FROM user_territories ut JOIN territories t ON t.id = ut.territory_id
                         WHERE ut.user_id = u.id), 'No region') AS region,
               EXISTS (SELECT 1 FROM user_territories ut WHERE ut.user_id = u.id AND ut.territory_id = :reg) AS in_region,
               ps.items, ps.score, ps.sales_level, ps.final_incentive_paise, st.final_amount_paise
        FROM users u
        LEFT JOIN LATERAL (SELECT * FROM performance_snapshot x WHERE x.officer_id = u.id AND x.period_id = :p
                           ORDER BY snapshot_date DESC LIMIT 1) ps ON true
        LEFT JOIN incentive_statement st ON st.officer_id = u.id AND st.period_id = :p
        WHERE u.id = ANY(:ids) ORDER BY u.full_name"""),
        {"p": period["id"], "ids": ids, "reg": region_id})).all()
    heat, spread = [], {0: 0, 1: 0, 2: 0, 3: 0}
    sales_t = sales_g = coll_t = coll_g = payable = 0
    by_region: dict[str, list[int]] = {}
    for r in rows:
        if mode and (r.work_mode or "both") != mode:
            continue
        if region_id and not r.in_region:
            continue
        cells: dict[str, Optional[float]] = {}
        sl = (r.items or {}).get("sales") or {}
        for part in ("field", "sales"):
            for code, it in ((r.items or {}).get(part) or {}).get("items", {}).items():
                cells[code] = None if it["skipped"] else it["pct"]
        heat.append({"officer_id": str(r.id), "name": r.full_name, "work_mode": r.work_mode, "region": r.region,
                     "score": float(r.score) if r.score is not None else None, "cells": cells})
        if sl and not sl.get("waiting_for_figures"):
            sales_t += sl["sales_paise"]; sales_g += sl["sales_goal_paise"]
            coll_t += sl["collection_paise"]; coll_g += sl["collection_goal_paise"]
            if r.sales_level in spread:
                spread[r.sales_level] += 1
            agg = by_region.setdefault(r.region, [0, 0])
            agg[0] += sl["sales_paise"]; agg[1] += sl["sales_goal_paise"]
        payable += (r.final_amount_paise if r.final_amount_paise is not None else (r.final_incentive_paise or 0))
    # team trend: sales vs goal for each month of the period
    months = repo.months_in(period["start"], period["end"]) if kind == "quarter" or period["type"] == "quarter" else \
        repo.months_in(period["start"], period["end"])
    oids = [uuid.UUID(h["officer_id"]) for h in heat]
    trend = []
    for y, m in months:
        a = (await s.execute(text("SELECT coalesce(sum(sales_amount_paise),0) AS s, coalesce(sum(collection_amount_paise),0) AS c "
                                  "FROM sales_figure WHERE year = :y AND month = :m AND officer_id = ANY(:o)"),
                             {"y": y, "m": m, "o": oids})).one()
        g = (await s.execute(text("SELECT coalesce(sum(g.value),0) FROM goal g JOIN kpi_item i ON i.id = g.item_id "
                                  "WHERE i.code = 'sales_done' AND g.year = :y AND g.month = :m AND g.officer_id = ANY(:o)"),
                             {"y": y, "m": m, "o": oids})).scalar_one()
        trend.append({"year": y, "month": m, "sales_paise": int(a.s), "collection_paise": int(a.c), "goal_paise": int(g)})
    regions = [{"region": k, "sales_paise": v[0], "goal_paise": v[1], "pct": (v[0] / v[1]) if v[1] else None}
               for k, v in sorted(by_region.items())]
    return {
        "period": {"id": str(period["id"]), "type": period["type"], "start": period["start"], "end": period["end"], "status": period["status"]},
        "items": [{"code": c, "name": meta.get(c, c)} for c in HEAT_ITEMS],
        "heat": heat,
        "totals": {"sales_paise": sales_t, "sales_goal_paise": sales_g, "collection_paise": coll_t,
                   "collection_goal_paise": coll_g, "incentive_payable_paise": payable},
        "level_spread": [{"level": k, "officers": v} for k, v in spread.items()],
        "trend": trend, "regions": regions,
    }
