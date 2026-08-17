from __future__ import annotations

import hashlib
import json
import logging
import time
import uuid
from collections.abc import Callable

from models import AgentDecision, JobRecord, ParsedSpec
from preflight import deterministic_blockers, inspect_pdf

log = logging.getLogger("trimgate")

ExtractSpecFn = Callable[[str], ParsedSpec]
DecideFn = Callable[[ParsedSpec, list], AgentDecision]
GetByIdempotencyFn = Callable[[str], JobRecord | None]
SaveFn = Callable[[JobRecord], None]


def trace_event(event: str, **data) -> dict:
    item = {"event": event, "ts_ms": int(time.time() * 1000), **data}
    log.info(json.dumps(item, ensure_ascii=False))
    return item


def idempotency_key(customer: str, request_text: str, artwork: bytes | None) -> str:
    h = hashlib.sha256()
    h.update(customer.encode())
    h.update(request_text.encode())
    if artwork:
        h.update(artwork)
    return h.hexdigest()


async def run_workflow(
    customer_name: str,
    request_text: str,
    artwork_name: str | None,
    artwork_bytes: bytes | None,
    *,
    extract_spec_fn: ExtractSpecFn,
    decide_fn: DecideFn,
    get_by_idempotency_fn: GetByIdempotencyFn,
    save_fn: SaveFn,
) -> JobRecord:
    trace = [trace_event("job_received", customer=customer_name, artwork=artwork_name)]
    idem = idempotency_key(customer_name, request_text, artwork_bytes)
    existing = get_by_idempotency_fn(idem)
    if existing:
        existing.trace.append(trace_event("idempotency_hit", job_id=existing.job_id))
        return existing

    parsed = extract_spec_fn(request_text)
    trace.append(trace_event("spec_extracted", missing=parsed.missing_fields))

    findings = list(deterministic_blockers(parsed))
    findings.extend(inspect_pdf(artwork_bytes, parsed))
    trace.append(
        trace_event(
            "preflight_completed",
            blockers=sum(f.severity == "blocker" for f in findings),
        )
    )

    decision = decide_fn(parsed, findings)
    trace.append(
        trace_event(
            "routing_decision",
            status=decision.status,
            route=decision.route,
            confidence=decision.confidence,
        )
    )

    job_id = f"TG-{uuid.uuid4().hex[:10].upper()}"
    trace.append(trace_event("job_persisting", job_id=job_id, route=decision.route))
    record = JobRecord(
        job_id=job_id,
        idempotency_key=idem,
        customer_name=customer_name,
        request_text=request_text,
        artwork_name=artwork_name,
        parsed_spec=parsed,
        findings=findings,
        decision=decision,
        trace=trace,
    )
    save_fn(record)
    trace_event("job_persisted", job_id=record.job_id, route=decision.route)
    return record
