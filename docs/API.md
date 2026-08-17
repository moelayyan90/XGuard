# XGuard HTTP API

**Production base URL:** `https://xguardgate.com`  
**Production network:** Base mainnet native USDC, x402 v2 `exact`, EIP-3009 authorization

A separate Base Sepolia testnet exists only for explicit non-billable integration testing. It is isolated from the production merchant billing path and is not the default API environment.

The machine-readable production contract is [openapi.yaml](openapi.yaml). Current official x402 v2 types remain authoritative where the protocol evolves.

## Public mainnet endpoints

| Method | Path           | Purpose                                                          |
| ------ | -------------- | ---------------------------------------------------------------- |
| GET    | `/`            | Release, network, pricing, billing model, and endpoint discovery |
| GET    | `/healthz`     | Worker liveness                                                  |
| GET    | `/readyz`      | D1 and fresh downstream facilitator readiness                    |
| GET    | `/supported`   | Measured x402 v2 mainnet capabilities                            |
| GET    | `/status`      | Gateway/facilitator health and open reconciliation count         |
| POST   | `/v1/register` | Create a merchant and return a one-time API key                  |

## Authenticated merchant endpoints

Use `Authorization: Bearer <XGUARD_API_KEY>`.

| Method | Path                                          | Purpose                                                                    |
| ------ | --------------------------------------------- | -------------------------------------------------------------------------- |
| GET    | `/v1/balance`                                 | Return available and held prepaid service balance                          |
| POST   | `/v1/topups/intents`                          | Create a one-time exact native-USDC Base deposit intent                    |
| POST   | `/v1/topups/claim`                            | Verify finality of a matching Base deposit and credit the merchant balance |
| GET    | `/v1/settlements/{logicalPaymentKey}/truth`   | Read XGuard's independent settlement truth                                 |
| POST   | `/v1/settlements/{logicalPaymentKey}/resolve` | Trigger an immediate independent finality/recovery check                   |
| POST   | `/verify`                                     | Validate a complete x402 v2 payment request without submitting value       |
| POST   | `/settle`                                     | Reserve the XGuard fee and submit one safe settlement route                |

`POST` requests use `Content-Type: application/json`. Mainnet `/verify` and `/settle` require the official v2 facilitator envelope containing `x402Version`, `paymentPayload`, and `paymentRequirements`.

## Mainnet payment matrix

XGuard mainnet currently accepts only:

- x402 version `2`;
- scheme `exact`;
- network `eip155:8453` (Base mainnet);
- native Base USDC contract `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`;
- `assetTransferMethod: "eip3009"`;
- authorization payment flow.

Unsupported networks, assets, schemes, and transfer mechanisms fail before settlement routing.

## Merchant registration

```http
POST /v1/register
Content-Type: application/json

{"name":"my-service"}
```

The response includes `merchant`, a high-entropy `apiKey`, and the configured treasury/network/asset metadata. The API key is a bearer credential and should be stored only in a secret manager or deployment secret.

## Prepaid service balance

Create an intent:

```http
POST /v1/topups/intents
Authorization: Bearer xg_live_...
Content-Type: application/json

{"amountUsd":"1.00"}
```

The response gives a one-time `claimToken`, `treasuryAddress`, and `exactDepositUsdc`. Send exactly that amount as native USDC on Base to the returned treasury address, then claim the finalized transaction:

```http
POST /v1/topups/claim
Authorization: Bearer xg_live_...
Content-Type: application/json

{"claimToken":"...","transactionHash":"0x..."}
```

Top-up deposits are customer prepayments and are recorded as an unearned liability until service fees are earned.

## Settlement Truth Layer

A downstream facilitator response is not the same thing as independent settlement truth. XGuard therefore exposes a merchant-facing state derived from finalized Base evidence and, for ambiguous EIP-3009 submissions, authorization recovery evidence.

The states are:

- `FINALIZED`: XGuard independently proved the exact expected USDC transfer on finalized Base state. `authoritativeForRelease` is `true`.
- `PENDING`: XGuard does not yet have sufficient final evidence. Do not resubmit the same authorization and do not treat this as a proven failure.
- `PROVEN_FAILED`: finalized/recovery evidence proves the expected settlement did not complete correctly or the authorization can no longer settle.
- `CONFLICT`: success and failure evidence disagree. XGuard fails closed and `authoritativeForRelease` remains `false`.

Read the current truth:

```http
GET /v1/settlements/{logicalPaymentKey}/truth
Authorization: Bearer xg_live_...
```

If the state is still `PENDING`, request an immediate resolution attempt instead of waiting for scheduled reconciliation:

```http
POST /v1/settlements/{logicalPaymentKey}/resolve
Authorization: Bearer xg_live_...
```

A pending response uses HTTP `202` and `Retry-After: 5`. Terminal truth responses use HTTP `200`. The response includes the expected payer, payee, amount, asset, network, transaction hash when known, evidence source, reason, and a SHA-256 `proofDigest` for terminal non-conflicting truth. The digest is an integrity identifier over invariant truth fields; it is not represented as an external signature or third-party attestation.

The truth endpoint is merchant-scoped: an API key cannot query another merchant's settlement record.

## Settlement billing boundary

The configured XGuard service fee is `2,000` micro-USD (`$0.002`) per successful billable settlement.

The lifecycle is:

1. reserve `$0.002` from the merchant's available service balance;
2. select one healthy compatible facilitator;
3. start at most one outbound settlement submission;
4. hold the fee after a downstream success while independent Base finality is checked;
5. expose that distinction to the merchant as settlement truth;
6. earn the fee only after finalized on-chain settlement is independently verified;
7. release the fee after a definitive finality failure;
8. keep ambiguity held for reconciliation without blind resubmission.

Malformed requests, verification failures, settlement failures, ambiguity, duplicate/replay retrievals, health/readiness/status traffic, and testnet activity are non-billable.

## Settlement response headers

Settlement responses may include:

- `X-XGuard-Replayed`: whether the result came from the durable replay cache;
- `X-XGuard-Payment-Key`: an immutable logical authorization correlation identity;
- `X-XGuard-Fee-State`: reservation/finality state for the XGuard service fee;
- `X-XGuard-Truth-State`: `FINALIZED`, `PENDING`, `PROVEN_FAILED`, or `CONFLICT` when a truth record is available;
- `X-XGuard-Truth-Endpoint`: merchant-scoped endpoint for the full truth record;
- `X-XGuard-Resolve-Endpoint`: endpoint that triggers an immediate resolution attempt;
- `X-XGuard-Release-Safe`: `true` only when XGuard's independent state is `FINALIZED`.

The payment key is an operational correlation value, not a bearer credential. A downstream `success: true` can therefore coexist briefly with `X-XGuard-Truth-State: PENDING`; the latter explicitly means XGuard has not yet promoted the payment to independently verified finality.

## Failure semantics

- malformed or unsupported input fails before routing;
- missing or invalid merchant authentication fails closed;
- verification does not submit value;
- settlement selects one route and never fails over after outbound submission starts;
- conflicting binding or an in-progress duplicate returns a conflict response;
- a non-definitive post-submit outcome becomes `AMBIGUOUS`, opens reconciliation state, and is not automatically resubmitted;
- settlement truth never converts missing evidence into success;
- conflicting truth evidence produces `CONFLICT`, never `FINALIZED`;
- insufficient service balance returns HTTP `402` with guidance to create a top-up intent;
- unhealthy, stale, or economically ineligible downstream routing fails closed.

## Optional testnet API

The separate Base Sepolia Worker remains non-billable at `https://xguard-testnet.maqamapp.workers.dev`. Use it only when a testnet environment is selected explicitly. Testnet behavior and capability are intentionally isolated from the mainnet merchant billing path.
