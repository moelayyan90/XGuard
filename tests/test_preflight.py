from pypdf import PdfWriter
from io import BytesIO

from models import ParsedSpec
from preflight import deterministic_blockers, inspect_pdf


def pdf(width_pt=595.28, height_pt=841.89):
    out = BytesIO()
    w = PdfWriter()
    w.add_blank_page(width=width_pt, height=height_pt)
    w.write(out)
    return out.getvalue()


def test_missing_quantity_is_blocker():
    spec = ParsedSpec(product="flyer", width_mm=148, height_mm=210, quantity=None, stock="150 gsm gloss")
    codes = {f.code for f in deterministic_blockers(spec)}
    assert "MISSING_QUANTITY" in codes


def test_a4_file_blocks_a5_request():
    spec = ParsedSpec(product="flyer", width_mm=148, height_mm=210, quantity=500, stock="150 gsm gloss")
    findings = inspect_pdf(pdf(), spec)
    assert any(f.code == "SIZE_MISMATCH" and f.severity == "blocker" for f in findings)
