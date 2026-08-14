# XGuard HTTP API

**Live base URL:** `https://xguard-testnet.maqamapp.workers.dev`  
**Release:** `0.1.0-alpha.0`  
**Mode:** Base Sepolia testnet only

The machine-readable contract is [openapi.yaml](openapi.yaml). Current official x402 v2 types remain authoritative where the protocol evolves.

## Public endpoints

| Method | Path         | Purpose                                                              |
| ------ | ------------ | -------------------------------------------------------------------- |
| GET    | `/`          | Release, mode, pricing policy, and endpoint discovery                |
| GET    | `/healthz`   | Worker liveness                                                      |
| GET    | `/readyz`    | D1 availability and at least one fresh compatible facilitator route  |
| GET    | `/supported` | Measured x402 v2 facilitator capabilities                            |
| GET    | `/status`    | Route state and open reconciliation count                            |
| POST   | `/verify`    | Validate a complete x402 v2 payment request without submitting value |
| POST   | `/settle`    | Settle once through the selected compatible testnet facilitator      |

`POST` requests require `Content-Type: application/json` and a complete official v2 facilitator request containing `x402Version`, `paymentPayload`, and `paymentRequirements`. Bodies, nesting, key count, duplicate keys, prototype keys, monetary values, authorization identity, and request binding are bounded and validated.

## Settlement response headers

Successful, failed-cached, and replayed settlement responses include:

- `X-XGuard-Replayed`: `false` for the original final result and `true` for a cached retry;
- `X-XGuard-Payment-Key`: the immutable logical authorization identity.

Do not log or expose the payment key as a bearer credential. It is an operational correlation value, not proof of authorization.

## Failure semantics

- malformed or unsupported input fails before routing;
- verification may move between compatible routes because it does not submit value;
- settlement selects one route and never fails over after submission begins;
- a conflicting retry returns HTTP `409`;
- an in-progress settlement returns HTTP `409` and may later be retried only to retrieve its cached final result;
- any non-definitive post-submit outcome returns HTTP `503` with `xguard_ambiguous`, creates reconciliation state, charges no fee, and is not automatically resubmitted;
- every non-testnet network is rejected with HTTP `503`.

## Billing boundary

The configured future mainnet service fee is `2,000` micro-USD (`$0.002`) per successful billable service event. Testnet, verification failure, settlement failure, ambiguity, replay, duplicate retry, malformed input, health, readiness, status, and capability traffic are non-billable. The deployed Worker cannot enable mainnet.

## Node-only operator endpoints

The portable Node gateway additionally implements authenticated payment status and balance endpoints, a bounded SSRF-safe compatibility checker, metrics, and an admin financial report. Those routes are not deployed by the public Worker and must not be inferred from the public OpenAPI document.
