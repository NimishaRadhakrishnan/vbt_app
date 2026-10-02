"""
Report Generation Use Case.
"""

from __future__ import annotations

import io
from datetime import date
from openpyxl import Workbook
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

from app.domain.repositories.attendance_repository import AttendanceRepository
from app.domain.repositories.visit_repository import VisitRepository
from app.domain.repositories.farmer_repository import FarmerRepository


class ReportUseCase:
    def __init__(
        self,
        attendance_repository: AttendanceRepository,
        visit_repository: VisitRepository,
        farmer_repository: FarmerRepository,
    ) -> None:
        self._attendance_repository = attendance_repository
        self._visit_repository = visit_repository
        self._farmer_repository = farmer_repository

    async def generate_attendance_pdf(self, date_val: date) -> io.BytesIO:
        attendance_list = await self._attendance_repository.list_by_date(date_val, limit=100)

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter, rightMargin=36, leftMargin=36, topMargin=36, bottomMargin=36)
        story = []

        styles = getSampleStyleSheet()
        title_style = ParagraphStyle(
            name="TitleStyle",
            parent=styles["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=18,
            textColor=colors.HexColor("#1b5e20"),
            spaceAfter=15,
        )
        body_style = styles["BodyText"]

        story.append(Paragraph(f"Vishakan Biotech - Attendance Summary Report ({date_val})", title_style))
        story.append(Spacer(1, 10))

        # Build table data
        data = [["Check-In Time", "Check-Out Time", "Device ID", "Fake GPS Detection"]]
        for att in attendance_list:
            data.append([
                att.check_in_time.strftime("%H:%M:%S"),
                att.check_out_time.strftime("%H:%M:%S") if att.check_out_time else "Active Shift",
                att.check_in_device_id[:10] + "...",
                "VIOLATION" if att.is_fake_gps else "Passed",
            ])

        table = Table(data, colWidths=[120, 120, 140, 120])
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1b5e20")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
            ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#f1f8e9")),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#c8e6c9")),
            ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
        ]))
        story.append(table)
        doc.build(story)
        buffer.seek(0)
        return buffer

    async def generate_farmer_excel(self) -> io.BytesIO:
        farmers = await self._farmer_repository.search(limit=100)

        wb = Workbook()
        ws = wb.active
        ws.title = "Farmer Directory"

        headers = ["Name", "Phone", "Village", "Taluk", "District", "Crop", "Acreage"]
        ws.append(headers)

        for farmer in farmers:
            ws.append([
                farmer.name,
                farmer.phone,
                farmer.village,
                farmer.taluk,
                farmer.district,
                farmer.crop,
                farmer.cents,
            ])

        buffer = io.BytesIO()
        wb.save(buffer)
        buffer.seek(0)
        return buffer
