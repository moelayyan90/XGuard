# ChangeMandate

ChangeMandate is a deterministic authorization-diff primitive for post-purchase changes performed by software agents.

Given the original authorized transaction and a proposed modification, it computes the economic and contractual delta and returns one of:

- `ALLOW`
- `ALLOW_WITHIN_PREAUTHORIZED_DELTA`
- `NEW_AUTHORIZATION_REQUIRED`

It detects positive one-time deltas, recurring liability, currency changes, merchant changes, multi-merchant changes and quantity increases. Authorization decisions never depend on an LLM.

## Endpoints

- `POST /v1/authorize-order-change`
- `POST /mcp`
- `GET /openapi.json`
- `GET /.well-known/changemandate`
- `GET /.well-known/x402`
- `GET /pricing`
- `GET /status`
- `GET /healthz`

## Payment readiness

The service exposes machine-readable per-operation pricing. Real x402 enforcement remains disabled unless a recipient address is explicitly configured; the service never pretends a payment succeeded.

## Security properties

- Safe-integer money representation in minor units
- Default-deny for uncovered liability
- Deterministic canonical change fingerprint
- Sharded Durable Object replay guard for request IDs and nonces
- Optional HMAC decision signatures through `DECISION_SIGNING_SECRET`
- Payload size limits and strict validation

ChangeMandate is an authorization decision aid and protocol service, not a bank, payment processor, merchant of record, or legal advisor.
