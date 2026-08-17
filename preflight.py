from __future__ import annotations

from io import BytesIO
from math import isclose
from typing import Iterable

from pypdf import PdfReader

from models import ParsedSpec, PreflightFinding

PT_TO_MM = 25.4 / 72.0
SIZE_TOLERANCE_MM = 1.0
MIN_BLEED_MM = 2.5


def _mm(box) -> tuple[float, float]:
    return (float(box.width) * PT_TO_MM, float(box.height) * PT_TO_MM)


def _finding(code: str, severity: str, message: str, **evidence) -> PreflightFinding:
    return PreflightFinding(code=code, severity=severity, message=message, evidence=evidence)


def inspect_pdf(pdf_bytes: bytes | None, spec: ParsedSpec) -> list[PreflightFinding]:
    findings: list[PreflightFinding] = []

    if not pdf_bytes:
        findings.append(_finding("NO_ARTWORK", "blocker", "No PDF artwork was supplied."))
        return findings

    try:
        reader = PdfReader(BytesIO(pdf_bytes), strict=False)
    except Exception as exc:  # noqa: BLE001
        findings.append(_finding("PDF_UNREADABLE", "blocker", "Artwork is not a readable PDF.", error=str(exc)))
        return findings

    if not reader.pages:
        findings.append(_finding("PDF_EMPTY", "blocker", "PDF contains no pages."))
        return findings

    findings.append(_finding("PAGE_COUNT", "info", f"PDF contains {len(reader.pages)} page(s).", pages=len(reader.pages)))

    page = reader.pages[0]
    media_w, media_h = _mm(page.mediabox)
    trim_w, trim_h = _mm(page.trimbox)
    bleed_w, bleed_h = _mm(page.bleedbox)

    findings.append(
        _finding(
            "PDF_GEOMETRY",
            "info",
            f"First-page trim size is {trim_w:.1f}×{trim_h:.1f} mm.",
            media_mm=[round(media_w, 2), round(media_h, 2)],
            trim_mm=[round(trim_w, 2), round(trim_h, 2)],
            bleed_mm=[round(bleed_w, 2), round(bleed_h, 2)],
        )
    )

    if spec.width_mm and spec.height_mm:
        normal = isclose(trim_w, spec.width_mm, abs_tol=SIZE_TOLERANCE_MM) and isclose(trim_h, spec.height_mm, abs_tol=SIZE_TOLERANCE_MM)
        rotated = isclose(trim_w, spec.height_mm, abs_tol=SIZE_TOLERANCE_MM) and isclose(trim_h, spec.width_mm, abs_tol=SIZE_TOLERANCE_MM)
        if not (normal or rotated):
            findings.append(
                _finding(
                    "SIZE_MISMATCH",
                    "blocker",
                    "PDF trim size does not match the requested finished size.",
                    requested_mm=[spec.width_mm, spec.height_mm],
                    detected_trim_mm=[round(trim_w, 2), round(trim_h, 2)],
                )
            )

    bleed_x = max(0.0, (bleed_w - trim_w) / 2)
    bleed_y = max(0.0, (bleed_h - trim_h) / 2)
    if bleed_x < MIN_BLEED_MM or bleed_y < MIN_BLEED_MM:
        findings.append(
            _finding(
                "BLEED_TOO_SMALL",
                "warning",
                f"Detected bleed is below {MIN_BLEED_MM:.1f} mm on at least one axis.",
                detected_bleed_mm=[round(bleed_x, 2), round(bleed_y, 2)],
                minimum_mm=MIN_BLEED_MM,
            )
        )

    resources = page.get("/Resources")
    font_count = 0
    if resources:
        try:
            resolved = resources.get_object()
            fonts = resolved.get("/Font")
            if fonts:
                font_count = len(fonts.get_object())
        except Exception:  # noqa: BLE001
            font_count = 0
    findings.append(_finding("FONT_RESOURCES", "info", f"Detected {font_count} font resource(s) on page 1.", count=font_count))

    return findings


def deterministic_blockers(spec: ParsedSpec) -> Iterable[PreflightFinding]:
    if spec.width_mm is None or spec.height_mm is None:
        yield _finding("MISSING_SIZE", "blocker", "Finished size is missing from the job request.")
    if spec.quantity is None or spec.quantity <= 0:
        yield _finding("MISSING_QUANTITY", "blocker", "A valid production quantity is missing.")
    if not spec.stock:
        yield _finding("MISSING_STOCK", "warning", "Paper/material stock is not specified.")
