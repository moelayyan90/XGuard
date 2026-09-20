"""Agent-side read. Supply only an operator-issued scoped capability."""
import json
import os
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


opener = urllib.request.build_opener(NoRedirect)


def call(path, body):
    request = urllib.request.Request(
        "https://api.xguardgate.com" + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    # A timeout may follow execution. Reuse the same input and key; no automatic retries.
    with opener.open(request, timeout=40) as response:
        return json.load(response)


result = call("/v1/secretless/call", {
    "capability": os.environ["XGUARD_CAPABILITY"],
    "operation": "github.repository.read",
    "input": {"owner": "moelayyan90", "repo": "XGuard"},
    "idempotency_key": "read-xguard-repository-001",
})
verified = call("/v1/receipts/verify", {
    "proof": result["proof"], "result_sha256": result["receipt"]["result_sha256"],
})
print(json.dumps({"execution_id": result["request_id"], "proof_valid": verified["valid"]}))
