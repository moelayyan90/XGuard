from __future__ import annotations

import json
import os
from typing import Any

from google import genai
from google.genai import types

from models import AgentDecision, ParsedSpec, PreflightFinding
from policy import enforce_decision

MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")


def _client() -> genai.Client:
    return genai.Client(api_key=os.getenv("GEMINI_API_KEY") or None)


def extract_spec(request_text: str) -> ParsedSpec:
    prompt = f"""
You are the intake agent for a commercial print production department.
Extract only explicit or strongly implied manufacturing specifications from the customer request.
Do not invent missing dimensions, material, quantity, colors, finishing, or deadline.
List missing production-critical fields in missing_fields.
Normalize dimensions to millimeters and quantity to an integer.

CUSTOMER REQUEST:
{request_text}
""".strip()
    response = _client().models.generate_content(
        model=MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=ParsedSpec,
        ),
    )
    return ParsedSpec.model_validate_json(response.text)


def decide(spec: ParsedSpec, findings: list[PreflightFinding]) -> AgentDecision:
    payload: dict[str, Any] = {
        "spec": spec.model_dump(),
        "findings": [f.model_dump() for f in findings],
    }
    prompt = f"""
You are the autonomous production gatekeeper for a print shop.
Your job is to prevent expensive production errors while allowing safe jobs to flow without human hand-holding.

Hard rules:
- If ANY finding has severity=blocker, status MUST be HOLD and route MUST be exceptions_queue.
- If there are no blockers, status MUST be READY and route MUST be production_queue.
- Never override deterministic measurements.
- required_actions must be concrete and minimal.
- operator_summary must be a concise work-ticket summary, not a chat response.

INPUT JSON:
{json.dumps(payload, ensure_ascii=False)}
""".strip()
    response = _client().models.generate_content(
        model=MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=AgentDecision,
        ),
    )
    result = AgentDecision.model_validate_json(response.text)
    return enforce_decision(result, findings)
