from __future__ import annotations

from models import AgentDecision, PreflightFinding


def enforce_decision(result: AgentDecision, findings: list[PreflightFinding]) -> AgentDecision:
    """Fail closed around the model: deterministic evidence owns release authority."""
    has_blocker = any(f.severity == "blocker" for f in findings)
    if has_blocker:
        if result.status != "HOLD" or result.route != "exceptions_queue":
            result.reason = "Deterministic preflight blocker enforced by safety policy. " + result.reason
        result.status = "HOLD"
        result.route = "exceptions_queue"
    else:
        result.status = "READY"
        result.route = "production_queue"
    return result
