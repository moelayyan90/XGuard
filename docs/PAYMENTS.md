# XGuard payments

XGuard's canonical x402 economic-attempt fee is **$0.04**.

- Autonomous agents should start at `GET /.well-known/payment-manifest`.
- Humans should start at `GET /pay`.
- Registration is `POST /v1/register`.
- Prepaid funding uses `POST /v1/topups/intents` and `POST /v1/topups/claim`.
- Protected x402 execution uses `POST /verify` and `POST /settle`.

The payment manifest is the machine-readable source of truth for payment onboarding and execution endpoints.
