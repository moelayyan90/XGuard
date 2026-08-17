import asyncio
from io import BytesIO

from pypdf import PdfWriter

from models import AgentDecision, JobRecord, ParsedSpec
from workflow import run_workflow


def a4_pdf() -> bytes:
    out = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=595.28, height=841.89)
    writer.write(out)
    return out.getvalue()


def test_workflow_holds_bad_artwork_and_is_idempotent():
    records: dict[str, JobRecord] = {}
    by_idem: dict[str, str] = {}

    def fake_extract(_text: str) -> ParsedSpec:
        return ParsedSpec(
            product="flyer",
            width_mm=148,
            height_mm=210,
            quantity=500,
            stock="150 gsm gloss",
        )

    def fake_decide(_spec, findings):
        blocker = any(f.severity == "blocker" for f in findings)
        return AgentDecision(
            status="HOLD" if blocker else "READY",
            route="exceptions_queue" if blocker else "production_queue",
            confidence=1.0,
            reason="test decision",
            operator_summary="test work order",
            required_actions=["replace artwork"] if blocker else [],
        )

    def fake_get(key: str):
        job_id = by_idem.get(key)
        return records.get(job_id) if job_id else None

    def fake_save(record: JobRecord):
        records[record.job_id] = record
        by_idem[record.idempotency_key] = record.job_id

    artwork = a4_pdf()
    kwargs = dict(
        extract_spec_fn=fake_extract,
        decide_fn=fake_decide,
        get_by_idempotency_fn=fake_get,
        save_fn=fake_save,
    )

    first = asyncio.run(
        run_workflow("CI Customer", "500 A5 flyers on 150 gsm gloss", "artwork.pdf", artwork, **kwargs)
    )
    second = asyncio.run(
        run_workflow("CI Customer", "500 A5 flyers on 150 gsm gloss", "artwork.pdf", artwork, **kwargs)
    )

    assert first.decision.status == "HOLD"
    assert first.decision.route == "exceptions_queue"
    assert any(f.code == "SIZE_MISMATCH" for f in first.findings)
    assert second.job_id == first.job_id
