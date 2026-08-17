from __future__ import annotations

import os
from threading import Lock

from google.cloud import firestore

from models import JobRecord

_MEMORY: dict[str, dict] = {}
_IDEMPOTENCY: dict[str, str] = {}
_LOCK = Lock()


def _firestore_client():
    if os.getenv("TRIMGATE_STORAGE", "firestore").lower() == "memory":
        return None
    # Production is deliberately fail-closed. A Firestore/IAM/configuration error
    # must surface instead of silently degrading durable state to process memory.
    return firestore.Client(project=os.getenv("GOOGLE_CLOUD_PROJECT") or None)


def get_by_idempotency(key: str) -> JobRecord | None:
    db = _firestore_client()
    if db:
        docs = db.collection("trimgate_jobs").where("idempotency_key", "==", key).limit(1).stream()
        for doc in docs:
            return JobRecord.model_validate(doc.to_dict())
        return None
    with _LOCK:
        job_id = _IDEMPOTENCY.get(key)
        return JobRecord.model_validate(_MEMORY[job_id]) if job_id else None


def save(record: JobRecord) -> None:
    db = _firestore_client()
    if db:
        batch = db.batch()
        ref = db.collection("trimgate_jobs").document(record.job_id)
        batch.set(ref, record.model_dump())
        queue = db.collection(record.decision.route).document(record.job_id)
        batch.set(
            queue,
            {
                "job_id": record.job_id,
                "status": record.decision.status,
                "summary": record.decision.operator_summary,
                "created_at": record.created_at,
            },
        )
        batch.commit()
        return
    with _LOCK:
        _MEMORY[record.job_id] = record.model_dump()
        _IDEMPOTENCY[record.idempotency_key] = record.job_id


def get(job_id: str) -> JobRecord | None:
    db = _firestore_client()
    if db:
        doc = db.collection("trimgate_jobs").document(job_id).get()
        return JobRecord.model_validate(doc.to_dict()) if doc.exists else None
    with _LOCK:
        item = _MEMORY.get(job_id)
        return JobRecord.model_validate(item) if item else None
