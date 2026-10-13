import io

import openpyxl

from app.application.services.stock_report_service import (
    STANDARD_PACKS, StockRow, normalise_pack, render_pdf, render_xlsx, split_product_name,
)


def test_split_and_normalise():
    assert split_product_name("V-NITRO (Liquid 5 Lit)") == ("V-NITRO", "Liquid", "5 Lit")
    assert split_product_name("V-BMC (950ml)") == ("V-BMC", "Standard", "950ml")
    assert normalise_pack("5 Lit") == "5L"
    assert normalise_pack("5 Ltr") == "5L"
    assert normalise_pack("500 ML") == "500ml"
    assert normalise_pack("1 Kg") == "1Kg"
    assert normalise_pack("box of 6") == "box of 6"


def _rows():
    return [
        StockRow("Sri Dealer", "Salem", "Ravi", "2026-10-12", "Bio-Fertilizers", "V-NITRO (Liquid 5 Lit)", 4),
        StockRow("Sri Dealer", "Salem", "Ravi", "2026-10-12", "Bio-Fertilizers", "V-NITRO (Liquid 500ml)", 10, "near expiry"),
        StockRow("Sri Dealer", "Salem", "Ravi", "2026-10-12", "Bio-Pesticides", "ODD (box of 6)", 1),
    ]


def test_xlsx_places_quantity_under_the_pack_column():
    ws = openpyxl.load_workbook(io.BytesIO(render_xlsx(_rows(), "t"))).active
    rows = [r for r in ws.iter_rows(values_only=True) if any(v is not None for v in r)]
    header = next(r for r in rows if r[0] == "Category")
    assert list(header[3:3 + len(STANDARD_PACKS)])[:3] == ["50ml", "100ml", "250ml"]
    assert "box of 6" in header  # unknown pack keeps its own column
    nitro = next(r for r in rows if r[1] == "V-NITRO")
    assert nitro[header.index("5L")] == 4 and nitro[header.index("500ml")] == 10
    assert nitro[-1] == "near expiry"


def test_pdf_is_a_pdf_and_empty_report_still_renders():
    assert render_pdf(_rows(), "t").startswith(b"%PDF")
    assert render_pdf([], "t").startswith(b"%PDF")
    assert render_xlsx([], "t")[:2] == b"PK"
