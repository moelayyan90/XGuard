# Stock Trends × XGuard — off-production canary proposal

This document is a review-ready patch specification for `skotlander/stocktrends-api` based on the current public `payments/x402.py`, `payments/enforcement.py`, and `middleware/metering.py` boundary.

The goal is deliberately narrow:

- keep Coinbase CDP as the default facilitator;
- permit XGuard only on an explicit route allow-list and an explicit deterministic traffic percentage;
- keep provider-specific authentication separate;
- fail closed on settlement ambiguity;
- make rollback one environment-variable change;
- preserve Stock Trends' current x402 challenge construction, pricing, `payTo`, and API semantics;
- make the effect on Coinbase CDP Bazaar indexing explicit.

No production switch is requested by this proposal.

## Current boundary observed in Stock Trends

The public code already centralizes facilitator traffic behind:

```python
X402_FACILITATOR_URL = os.getenv(
    "X402_FACILITATOR_URL",
    "https://api.cdp.coinbase.com/platform/v2/x402",
).rstrip("/")
```

`verify_with_facilitator()` and `settle_with_facilitator()` are called from `payments/enforcement.py`, which already receives the request `path` and a normalized payment reference. This is a clean place to make a route-scoped provider decision without touching pricing or resource handlers.

## Proposed environment contract

Default behavior remains CDP-only because the canary route list is empty and the percentage is zero.

```env
# Existing CDP settings remain unchanged.
X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
X402_FACILITATOR_API_KEY=...
X402_FACILITATOR_API_SECRET=...

# XGuard is opt-in only.
X402_XGUARD_URL=https://xguardgate.com
X402_XGUARD_API_KEY=...

# Exact comma-separated request paths eligible for the canary.
X402_XGUARD_CANARY_ROUTES=

# 0..100. Default 0 means immediate rollback / no XGuard traffic.
X402_XGUARD_CANARY_PERCENT=0
```

For an off-production review, a single route could be enabled with `X402_XGUARD_CANARY_PERCENT=100` in staging only. A production canary, if later approved, can use a low percentage such as 1–5 while CDP remains the majority path.

## 1. Add a small provider abstraction in `payments/x402.py`

Add `hashlib` to imports and extend the validation result with non-secret provider/truth telemetry:

```python
import hashlib

@dataclass
class X402ValidationResult:
    valid: bool
    error_code: Optional[str] = None
    error_detail: Optional[str] = None
    payment_reference: Optional[str] = None
    payment_network: Optional[str] = None
    payment_token: Optional[str] = None
    payment_amount_native: Optional[Decimal] = None
    payment_signature: Optional[str] = None
    payment_payload: Optional[dict[str, Any]] = None
    verification_response: Optional[dict[str, Any]] = None
    settlement_response: Optional[dict[str, Any]] = None
    facilitator_name: Optional[str] = None
    truth_state: Optional[str] = None
    release_safe: Optional[bool] = None
```

Add XGuard configuration next to the existing facilitator configuration:

```python
X402_XGUARD_URL = os.getenv("X402_XGUARD_URL", "https://xguardgate.com").rstrip("/")
X402_XGUARD_API_KEY = os.getenv("X402_XGUARD_API_KEY", "").strip()
X402_XGUARD_CANARY_ROUTES = {
    value.strip()
    for value in os.getenv("X402_XGUARD_CANARY_ROUTES", "").split(",")
    if value.strip()
}

try:
    X402_XGUARD_CANARY_PERCENT = max(
        0,
        min(100, int(os.getenv("X402_XGUARD_CANARY_PERCENT", "0"))),
    )
except ValueError:
    X402_XGUARD_CANARY_PERCENT = 0

@dataclass(frozen=True)
class X402FacilitatorTarget:
    name: str
    base_url: str
```

Select the provider deterministically. The payment reference is hashed only for traffic bucketing; no signature or key is logged.

```python
def _select_facilitator(
    *,
    path: str | None,
    payment_reference: str | None,
) -> X402FacilitatorTarget:
    cdp = X402FacilitatorTarget("cdp", X402_FACILITATOR_URL)

    if not path or path not in X402_XGUARD_CANARY_ROUTES:
        return cdp
    if X402_XGUARD_CANARY_PERCENT <= 0:
        return cdp
    if not X402_XGUARD_API_KEY:
        # Never route to XGuard without its provider-specific credential.
        return cdp

    stable_key = f"{path}|{payment_reference or ''}".encode("utf-8")
    bucket = int.from_bytes(hashlib.sha256(stable_key).digest()[:4], "big") % 100
    if bucket >= X402_XGUARD_CANARY_PERCENT:
        return cdp

    return X402FacilitatorTarget("xguard", X402_XGUARD_URL)
```

## 2. Keep authentication provider-specific

Do not send CDP JWT credentials to XGuard, and do not send the XGuard bearer credential to CDP.

Replace the existing one-provider header helper with:

```python
def _facilitator_headers(
    target: X402FacilitatorTarget,
    method: str,
    url: str,
) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}

    if target.name == "xguard":
        headers["Authorization"] = f"Bearer {X402_XGUARD_API_KEY}"
        return headers

    bearer = _build_cdp_bearer_token(method, url)
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    return headers
```

`_post_json()` should accept the selected target and return response headers as a lowercase dictionary in addition to status/body. This is required only so XGuard settlement-truth headers can be interpreted without changing Stock Trends' response schema.

Conceptually:

```python
def _post_json(target, url, payload):
    ...
    req = urllib_request.Request(
        url,
        data=data,
        headers=_facilitator_headers(target, "POST", url),
        method="POST",
    )
    ...
    response_headers = {k.lower(): v for k, v in resp.headers.items()}
    return resp.status, parsed, body, response_headers
```

The HTTP-error branch should return the same four-tuple with the available response headers.

## 3. Make verify and settle choose the same route

Extend both public helpers with two optional inputs:

```python
path: str | None = None,
payment_reference: str | None = None,
```

Then select the target exactly once per call:

```python
target = _select_facilitator(
    path=path,
    payment_reference=payment_reference,
)
```

Use:

```python
f"{target.base_url}/verify"
f"{target.base_url}/settle"
```

Return `facilitator_name=target.name` in every success/failure result.

Logging should contain the provider name, HTTP status, and request correlation id if available, but must not log API keys, bearer tokens, or raw payment signatures.

## 4. Explicit XGuard ambiguity handling

XGuard's mainnet contract distinguishes a downstream success from independently finalized settlement truth. The important response headers are:

```text
X-XGuard-Truth-State: FINALIZED | PENDING | PROVEN_FAILED | CONFLICT
X-XGuard-Release-Safe: true | false
X-XGuard-Payment-Key: ...
```

For CDP, preserve current settlement behavior exactly.

For XGuard, do not release the resource merely because a downstream response says `success: true`. The resource should be released only when XGuard says release is safe.

After the current generic `settled` check in `settle_with_facilitator()`:

```python
truth_state = response_headers.get("x-xguard-truth-state")
release_safe = response_headers.get("x-xguard-release-safe", "").lower() == "true"

if target.name == "xguard" and not release_safe:
    return X402ValidationResult(
        valid=False,
        error_code="payment_settlement_ambiguous",
        error_detail=(
            "XGuard has not independently promoted this payment to finalized release-safe state. "
            "Do not resubmit the same authorization blindly."
        ),
        payment_signature=payment_signature,
        payment_payload=payment_payload,
        settlement_response=data,
        facilitator_name=target.name,
        truth_state=truth_state or "PENDING",
        release_safe=False,
    )
```

A finalized XGuard response returns:

```python
facilitator_name="xguard",
truth_state=truth_state,
release_safe=True,
```

## 5. Pass route identity from `payments/enforcement.py`

The existing enforcement code already has both values needed to keep verify and settle on the same deterministic provider.

Change:

```python
verify_result = verify_with_facilitator(
    payment_signature=payment_signature,
    payment_requirements=current_payment_requirements,
)
```

to:

```python
verify_result = verify_with_facilitator(
    payment_signature=payment_signature,
    payment_requirements=current_payment_requirements,
    path=path,
    payment_reference=replay_reference,
)
```

and make the same addition to `settle_with_facilitator()`.

Add one non-secret field to `PaymentEnforcementResult`:

```python
facilitator_name: Optional[str] = None
```

Set `payment_channel_id` to a stable non-secret value such as:

```text
x402:cdp
x402:xguard
```

This reuses Stock Trends' existing economics/event telemetry rather than creating a new database migration merely for the canary.

If settle returns `payment_settlement_ambiguous`, return a distinct enforcement outcome:

```python
outcome="settlement_ambiguous"
```

Do not classify it as a definitive payment failure.

## 6. Handle ambiguous settlement in `middleware/metering.py`

Before the existing `settlement_failed` branch, add a dedicated branch for `settlement_ambiguous`.

Recommended response:

```python
response = JSONResponse(
    status_code=202,
    content={
        "error": "payment_settlement_pending",
        "detail": enforcement_result.error_detail,
        "request_id": request_id,
        "payment_reference": enforcement_result.payment_reference,
        "facilitator": enforcement_result.facilitator_name,
    },
)
response.headers["Retry-After"] = "5"
```

Important behavior:

- do not return a new `402` for this state;
- do not tell the client to create a new authorization;
- do not mark the payment as definitively failed;
- do not release the resource until finality is independently safe;
- log `payment_status="pending"` and `payment_channel_id="x402:xguard"`.

That is the critical distinction that prevents an ambiguous post-submit outcome from turning into a double-payment retry.

## 7. Rollback

No code rollback is required to stop the canary.

Immediate rollback:

```env
X402_XGUARD_CANARY_PERCENT=0
```

or:

```env
X402_XGUARD_CANARY_ROUTES=
```

Both restore 100% CDP routing while leaving the provider abstraction dormant.

A full source rollback can be done later by reverting the patch, but it should not be required for an incident response.

## 8. Telemetry to compare during review

At minimum compare by `payment_channel_id`:

- verify success/failure rate;
- settle success/failure rate;
- settlement ambiguity rate;
- p50/p95 verify latency;
- p50/p95 settle latency;
- replay/duplicate rejection rate;
- resource-release rate;
- any customer-visible 202 pending responses;
- rollback count.

Do not compare XGuard by raw downstream `success` alone. The relevant XGuard success measure is release-safe independently finalized settlement.

## 9. Coinbase CDP Bazaar indexing / quality effect

Coinbase's current Bazaar documentation states that:

1. indexing occurs after a successful **settle through the CDP Facilitator**; verify alone is not enough;
2. Bazaar quality ranking uses facilitator-observed buyer reach, transaction volume, recency, and metadata quality;
3. these traffic signals are derived from traffic that CDP itself observes.

Official reference:

- https://docs.cdp.coinbase.com/x402/bazaar

Therefore, XGuard/xpay-settled canary traffic should **not** be assumed to increment Coinbase CDP Bazaar buyer-reach, transaction-volume, or recency signals for that transaction. A route that moves 100% away from CDP may gradually lose CDP-observed freshness/ranking even if its existing catalog record remains present.

For that reason this proposal keeps CDP as the default and recommends a small route-scoped XGuard canary. That makes the trade-off measurable instead of silently exchanging settlement-safety testing for discovery-ranking damage.

This proposal does not claim that XGuard can write CDP Bazaar quality signals on CDP's behalf.

## 10. Off-production test matrix

Before any live canary, validate these cases with network calls mocked unless a dedicated staging credential is intentionally configured.

### Provider selection

- no allow-list -> CDP;
- allow-list + 0% -> CDP;
- allow-list + 100% + missing XGuard credential -> CDP;
- allow-list + 100% + XGuard credential -> XGuard;
- non-allow-listed route always -> CDP;
- the same `(path, payment_reference)` deterministically selects the same provider for verify and settle.

### Authentication isolation

- CDP request receives only CDP JWT auth;
- XGuard request receives only `Authorization: Bearer <X402_XGUARD_API_KEY>`;
- no raw credential is logged.

### Settlement semantics

- CDP successful settlement behavior unchanged;
- XGuard `FINALIZED + release-safe=true` -> proceed;
- XGuard `PENDING` -> HTTP 202, no resource release, no new 402;
- XGuard `CONFLICT` -> fail closed;
- XGuard unreachable before submit -> fail closed;
- ambiguous post-submit outcome -> never automatically switch to CDP for the same authorization.

### Rollback

- set percentage to `0` and assert all subsequent new payment references route to CDP.

## 11. Scope deliberately excluded

This proposal does not:

- modify Stock Trends pricing;
- modify `payTo`;
- modify buyer-signed x402 payment requirements;
- change CDP from the default;
- claim that XGuard owns the downstream xpay signer;
- send a second settlement route after an ambiguous submit;
- claim that non-CDP settlements improve Coinbase Bazaar quality signals;
- ask Stock Trends to enable production traffic before off-production review.

## Suggested first review configuration

For staging / mocked provider tests:

```env
X402_XGUARD_CANARY_ROUTES=/v1/prices/latest
X402_XGUARD_CANARY_PERCENT=100
```

For any later production canary, use an explicitly approved route and a low percentage while keeping CDP as the immediate operational rollback.
