# XGuard Payment Decision

This document is the canonical contract for XGuard's buyer/agent-side payment-decision surface.

## Product boundary

XGuard Payment Decision is an optional pre-payment verification, decision, and independent transaction-evidence layer. It is not defined by x402. x402 remains a settlement/protocol adapter in the wider XGuard runtime.

XGuard cannot appear inside an arbitrary checkout from the public website alone. Automatic buyer-side surfacing is provided by a browser-side client with user-granted site access. Automatic agent-side surfacing is provided through the XGuard MCP tool catalog. Neither path requires the merchant to adopt an XGuard SDK merely to let the buyer/agent request a decision.

## Economic invariant

The following are non-billable:

- detecting a possible payment locally;
- `POST /v1/payment/offer`;
- MCP `xguard_payment_offer`;
- choosing `Continue without XGuard`;
- a failed XGuard decision request that does not produce a durable result;
- appending the final payment outcome to an already-paid XGuard record.

A fee becomes earned when XGuard has completed the requested `ALLOW`, `REVIEW`, or `BLOCK` decision and created the durable evidence record. The underlying purchase does not have to succeed afterward; the purchased XGuard service is the decision/evidence result itself.

The same `requestId` is the idempotency boundary. Replaying a completed request returns the existing record and must not earn a second XGuard fee.

## Buyer flow

```text
payment context detected locally
          |
          v
free XGuard offer ----------------------> continue without XGuard
          |                                      |
          | opt in                               +--> original payment untouched
          v
fee coverage reserved
          |
          v
validate declared intent
          |
          +--> amount integrity
          +--> payee/destination integrity
          +--> transport/origin integrity
          +--> intent expiry
          +--> rail coverage
          +--> crypto network context
          +--> settled-reference replay check
          |
          v
ALLOW / REVIEW / BLOCK + reason codes + checks
          |
          v
durable independent transaction record + SHA-256 evidence hash
          |
          v
XGuard fee earned exactly once
          |
          v
buyer/agent may pay or cancel
          |
          v
optional settlement outcome appended to the same record (no second fee)
```

## API

### Free offer

`POST /v1/payment/offer`

The response contains the current decision fee and the explicit `Use XGuard` / `Continue without XGuard` actions. The offer itself is never billable.

### Paid decision

`POST /v1/payment/decision`

Requires an XGuard access credential with billing scope and a funded XGuard service balance.

Required fields:

- `requestId`
- `rail`
- `provider`
- `amount` as a positive decimal string
- `currency`
- `payee`

Optional evidence fields include `merchantOrigin`, `network`, `asset`, `expectedAmount`, `expectedPayee`, `expiresAt`, `paymentReference`, and bounded primitive metadata.

The API rejects raw credential-shaped fields such as card/PAN/CVV/CVC/PIN, private keys, seed phrases, and mnemonics. XGuard needs transaction facts, not payment secrets.

### Retrieve record

`GET /v1/payment/records/{decisionId}`

Returns the independent transaction record for its authenticated XGuard principal.

### Append payment outcome

`POST /v1/payment/records/{decisionId}/settlement`

Accepted statuses are `SETTLED`, `FAILED`, `CANCELLED`, and `UNKNOWN`. A settled outcome requires the provider transaction reference. This update creates a second SHA-256 evidence hash chained to the original decision evidence and does not earn another XGuard fee.

## Agent surface

The modern MCP server exposes:

- `xguard_payment_offer`: free, optional offer for an agent that is about to spend money;
- `xguard_payment_decision`: paid only on completed decision/evidence; idempotent by `requestId` and never executes the underlying payment.

Tool annotations intentionally mark the decision as non-read-only because earning the service fee is an economic side effect.

## Decision semantics

`ALLOW` means the checks supported by the supplied evidence produced no blocking or review condition. It does **not** mean that merchant reputation, solvency, card-network authorization, fraud impossibility, or opaque provider internals were magically verified.

`REVIEW` means the declared intent can be analyzed but one or more coverage/context warnings remain.

`BLOCK` means a supplied or previously recorded fact conflicts with the intended payment, such as an amount mismatch, destination mismatch, insecure payment origin, expired intent, or reuse of a reference already recorded as settled.

The response includes the exact checks and reason codes so the result is auditable instead of a bare `safe: true` claim.

## Browser privacy boundary

The browser surface detects likely checkout contexts locally. It does not send checkout facts to XGuard merely because the offer appeared. Data is sent only after the user chooses `Use XGuard`. The content script does not intentionally read payment-input values and does not inspect cross-origin payment iframes.

## Security evidence

`GET /.well-known/xguard-security-evidence.json` describes the measurable gates. `.github/workflows/payment-security-evidence.yml` generates commit-bound evidence artifacts containing the targeted test report, dependency audit output, source commit, and SHA-256 checksums.

No pass count is hard-coded into the product. A security claim exists only when the corresponding CI result exists for that commit.
