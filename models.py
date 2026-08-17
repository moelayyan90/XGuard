from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, Field

Severity = Literal["info", "warning", "blocker"]
Route = Literal["production_queue", "exceptions_queue"]
DecisionStatus = Literal["READY", "HOLD"]


class ParsedSpec(BaseModel):
    product: str = Field(description="Printed product, e.g. business card, brochure, label")
    width_mm: float | None = Field(default=None, description="Finished width in millimeters")
    height_mm: float | None = Field(default=None, description="Finished height in millimeters")
    quantity: int | None = None
    stock: str | None = None
    colors: str | None = None
    finishing: list[str] = Field(default_factory=list)
    deadline: str | None = None
    notes: list[str] = Field(default_factory=list)
    missing_fields: list[str] = Field(default_factory=list)


class PreflightFinding(BaseModel):
    code: str
    severity: Severity
    message: str
    evidence: dict = Field(default_factory=dict)


class AgentDecision(BaseModel):
    status: DecisionStatus
    route: Route
    confidence: float = Field(ge=0, le=1)
    reason: str
    operator_summary: str
    required_actions: list[str] = Field(default_factory=list)


class JobRecord(BaseModel):
    job_id: str
    idempotency_key: str
    customer_name: str
    request_text: str
    artwork_name: str | None = None
    parsed_spec: ParsedSpec
    findings: list[PreflightFinding]
    decision: AgentDecision
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    trace: list[dict] = Field(default_factory=list)
