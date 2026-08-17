from models import AgentDecision, PreflightFinding
from policy import enforce_decision


def decision(status="READY", route="production_queue"):
    return AgentDecision(
        status=status,
        route=route,
        confidence=0.99,
        reason="model said release",
        operator_summary="demo",
        required_actions=[],
    )


def test_blocker_cannot_be_overridden_by_model():
    result = enforce_decision(
        decision(),
        [PreflightFinding(code="SIZE_MISMATCH", severity="blocker", message="wrong size")],
    )
    assert result.status == "HOLD"
    assert result.route == "exceptions_queue"
    assert "safety policy" in result.reason


def test_no_blocker_routes_to_production():
    result = enforce_decision(decision(status="HOLD", route="exceptions_queue"), [])
    assert result.status == "READY"
    assert result.route == "production_queue"
