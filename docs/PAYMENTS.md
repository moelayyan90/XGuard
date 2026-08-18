# XGuard payments

XGuard's canonical x402 economic-attempt fee is **$0.03 (30,000 micro-USD)** per accepted authenticated economic attempt.

- Autonomous agents should start at `GET /.well-known/payment-manifest`.
- Humans should start at `GET /pay`.
- Registration is `POST /v1/register`.
- Prepaid funding uses `POST /v1/topups/intents` and `POST /v1/topups/claim`.
- Protected x402 execution uses `POST /verify` and `POST /settle`.
- A2A agents can use `GET /.well-known/agent-card.json` and `POST /a2a`.

The fixed x402 attempt fee is earned after merchant authentication, supported-request parsing, canonical `logicalPaymentKey` derivation, and successful prepaid-balance reservation, **before downstream execution**. A downstream verification or settlement failure does not refund an accepted attempt. Malformed or unauthenticated requests and idempotent retries do not add another fixed attempt fee.

Settlement truth and finality remain separate from fee timing: `/v1/settlements/{logicalPaymentKey}/truth` reports whether the expected Base USDC transfer is independently proven, pending, failed, or conflicting.

The payment manifest is the machine-readable source of truth for payment onboarding, network/asset identity, pricing, billing event, and execution endpoints.
