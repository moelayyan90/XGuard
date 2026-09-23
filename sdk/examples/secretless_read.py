"""Run from the repository root: python -m sdk.examples.secretless_read --help.

The operator must provision a raw HTTPS grant and a forecast for this exact read.
Provider and wallet keys stay at XGuard. The pinned JWK is a PUBLIC verification key.
"""
import argparse
import json
from pathlib import Path
from sdk.xguard_governance import Operation, XGuardAuthorizationGateway

parser = argparse.ArgumentParser(description="One governed repository read; no automatic retries")
parser.add_argument("--capability-file", required=True)
parser.add_argument("--pinned-jwk", required=True)
parser.add_argument("--journal", required=True)
parser.add_argument("--operation-key", required=True, help="Persist this key for this business operation")
args = parser.parse_args()

gateway = XGuardAuthorizationGateway(
    capability=Path(args.capability_file).read_text().strip(),
    pinned_jwk=json.loads(Path(args.pinned_jwk).read_text()),
    journal=args.journal,
)
# execute obtains and verifies a request-bound ticket before provider dispatch.
# A timeout or bad signature durably halts; do not delete the journal to retry.
result = gateway.execute(Operation(
    "https://api.github.com/repos/moelayyan90/XGuard", args.operation_key,
))
print(json.dumps({"status": result.status, "execution_id": result.evidence["execution_id"],
                  "proof_verified": True, "result": json.loads(result.body)}))
