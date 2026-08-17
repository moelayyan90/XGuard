# XGuard Payment Decision

This document is the canonical contract for XGuard's buyer/agent-side payment-decision surface.

## Product boundary

XGuard Payment Decision is an optional pre-payment verification, decision, and independent transaction-evidence layer. It is not defined by x402. x402 remains a settlement/protocol adapter in the wider XGuard runtime.

XGuard cannot appear inside an arbitrary checkout from the public website alone. Automatic buyer-side surfacing is provided by a browser-side client with user-granted site access. Automatic agent-side surfacing is provided through the XGuard MCP tool catalog. Neither path requires the merchant to adopt an XGuard SDK merely to let the buyer/agent request a decision.

## Buyer Pass

A human buyer or autonomous agent does not need to become an XGuard merchant merely to request a payment decision. `POST /v1/buyer-pass` creates a dedicated Buyer Pass backed by the same audited prepaid ledger used by XGuard billing. The plaintext `xg_pass_...` token is returned once; XGuard stores only its SHA-256 hash.

The browser extension creates and stores its Buyer Pass locally when XGuard is first used. A Buyer Pass can read its service balance and create/claim prepaid top-ups without exposing a merchant API key. Existing merchant credentials remain accepted for backwards compatibility and B2B integrations.

Current Buyer Pass top-ups use native USDC on Base through the existing finalized-deposit verification path. The minimum top-up is $0.01. Additional funding rails can be added without changing the Payment Decision fee invariant.

## Economic invariant

The following are non-billable:

- detecting a possible payment locally;
- `POST /v1/payment/offer`;
- MCP `xguard_payment_offer`;
- creating or reading a Buyer Pass;
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
Buyer Pass created/reused locally
          |
          v
fee coverage reserved from XGuard balance
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

The response contains the current decision fee and the explicit `Use XGuard` / `Continue without XGuard` actions. The offer itself is never billable. It also advertises the Buyer Pass endpoint so a new buyer can connect without a merchant credential.

### Buyer Pass

`POST /v1/buyer-pass`

Creates a buyer/agent credential and returns the plaintext Buyer Pass once.

`GET /v1/buyer-pass`

Returns the authenticated Buyer Pass identity and current prepaid service balance.

`POST /v1/buyer-pass/topups/intents`

Creates an exact-amount Base USDC top-up instruction using the existing XGuard treasury and top-up ledger.

`POST /v1/buyer-pass/topups/claim`

Verifies the finalized Base USDC transfer and credits the Buyer Pass service balance.

`POST /v1/buyer-pass/rotate`

Rotates the Buyer Pass. The previous token becomes invalid immediately.

### Paid decision

`POST /v1/payment/decision`

Accepts either an XGuard Buyer Pass or an existing XGuard merchant credential. The authenticated principal must have enough prepaid XGuard service balance to reserve the current decision fee.

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

Agents may use a Buyer Pass as the authorization credential for `xguard_payment_decision`, so they do not need a merchant identity merely to purchase the XGuard check. Tool annotations intentionally mark the decision as non-read-only because earning the service fee is an economic side effect.

## Decision semantics

`ALLOW` means the checks supported by the supplied evidence produced no blocking or review condition. It does **not** mean that merchant reputation, solvency, card-network authorization, fraud impossibility, or opaque provider internals were magically verified.

`REVIEW` means the declared intent can be analyzed but one or more coverage/context warnings remain.

`BLOCK` means a supplied or previously recorded fact conflicts with the intended payment, such as an amount mismatch, destination mismatch, insecure payment origin, expired intent, or reuse of a reference already recorded as settled.

The response includes the exact checks and reason codes so the result is auditable instead of a bare `safe: true` claim.

## Browser privacy boundary

The browser surface detects likely checkout contexts locally. It does not send checkout facts to XGuard merely because the offer appeared. Data is sent only after the user chooses `Use XGuard`. The content script does not intentionally read payment-input values and does not inspect cross-origin payment iframes.

The Buyer Pass is stored in extension-local storage and sent only to XGuard endpoints as an authorization credential. It is not inserted into merchant pages or checkout forms.

## Security evidence

`GET /.well-known/xguard-security-evidence.json` describes the measurable gates. `.github/workflows/payment-security-evidence.yml` generates commit-bound evidence artifacts containing the targeted test report, dependency audit output, source commit, and SHA-256 checksums.

No pass count is hard-coded into the product. A security claim exists only when the corresponding CI result exists for that commit.
