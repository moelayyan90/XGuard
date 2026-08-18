# XGuard HTTP API

**Production base URL:** `https://xguardgate.com`  
**Production network:** Base mainnet (`eip155:8453`), native USDC, x402 v2 `exact`, EIP-3009 authorization

A separate Base Sepolia testnet exists only for explicit non-billable integration testing. It is isolated from the production merchant billing path and is not the default API environment.

The live machine-readable HTTP contract is `GET /openapi.json`. The canonical commercial/payment contract is `GET /.well-known/payment-manifest`. Current official x402 v2 types remain authoritative where the protocol evolves.

## Public mainnet endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Release/network/endpoint discovery |
| GET | `/healthz` | Worker liveness |
| GET | `/readyz` | D1 and downstream route readiness |
| GET | `/supported` | Authoritative live x402 capabilities |
| GET | `/status` | Operational status |
| GET | `/.well-known/payment-manifest` | Canonical payment/onboarding/pricing manifest |
| GET | `/.well-known/x402/facilitator.json` | XGuard facilitator provider metadata |
| GET | `/.well-known/agent-card.json` | Agent/A2A discovery metadata |
| GET | `/.well-known/mcp/server.json` | MCP server metadata |
| GET | `/openapi.json` | Live OpenAPI description |
| POST | `/v1/register` | Create a merchant and issue a one-time API key |

Machine-readable discovery **metadata** is free. Value-producing `/discovery/resources` and `/discovery/search` operations use the separate SOURCE execution class and must not be confused with free metadata.

## Authenticated merchant endpoints

Use `Authorization: Bearer <XGUARD_API_KEY>`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/balance` | Return prepaid service balance |
| POST | `/v1/topups/intents` | Create a one-time exact native-USDC Base deposit intent |
| POST | `/v1/topups/claim` | Verify and claim a matching finalized Base USDC deposit |
| GET | `/v1/settlements/{logicalPaymentKey}/truth` | Read independent settlement truth |
| POST | `/v1/settlements/{logicalPaymentKey}/resolve` | Re-evaluate settlement truth without blind resubmission |
| POST | `/verify` | Execute protected x402 verification |
| POST | `/settle` | Execute protected guarded x402 settlement |

`POST` requests use `Content-Type: application/json`. Mainnet `/verify` and `/settle` require the official v2 facilitator envelope containing `x402Version`, `paymentPayload`, and `paymentRequirements`.

## Mainnet payment matrix

XGuard mainnet currently accepts only:

- x402 version `2`;
- scheme `exact`;
- network `eip155:8453` (Base mainnet);
- native Base USDC contract `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`;
- `assetTransferMethod: "eip3009"`;
- authorization payment flow.

Unsupported networks, assets, schemes, and transfer mechanisms fail before accepted protected execution.

## Merchant registration

```http
POST /v1/register
Content-Type: application/json

{"name":"my-service"}
```

The response includes the merchant identity, a high-entropy `apiKey`, and configured treasury/network/asset metadata. The API key is a bearer credential and should be kept only in a secret manager or deployment secret.

## Prepaid service balance

Create an intent:

```http
POST /v1/topups/intents
Authorization: Bearer xg_live_...
Content-Type: application/json

{"amountUsd":"1.00"}
```

The response gives a one-time `claimToken`, `treasuryAddress`, and exact native Base USDC amount. Send exactly that amount to the returned treasury address, then claim the finalized transfer:

```http
POST /v1/topups/claim
Authorization: Bearer xg_live_...
Content-Type: application/json

{"claimToken":"...","transactionHash":"0x..."}
```

Top-up deposits are customer prepayments and remain a liability until XGuard service is earned.

## Canonical x402 billing boundary

The canonical fixed XGuard x402 service fee is **30,000 micro-USD (`$0.03`) once per accepted authenticated economic attempt**.

The sequence is:

1. authenticate the merchant scope;
2. parse/normalize a supported economic x402 request;
3. derive the canonical `logicalPaymentKey`;
4. reserve `$0.03` from the merchant's prepaid XGuard service balance;
5. earn that fee before downstream execution; and
6. execute verification or settlement.

The same `logicalPaymentKey` is idempotent: verify → settle and retries do not earn the fixed fee twice.

Malformed or unsupported traffic rejected before acceptance, unauthenticated traffic, and idempotent retries do not incur an additional canonical attempt fee. Once an authenticated economic attempt has been accepted and earned, a later downstream verification/settlement failure does **not** refund that fixed attempt fee.

Insufficient prepaid balance returns HTTP `402` with guidance to create a top-up intent.

## Accepted-attempt response headers

Protected x402 responses can include:

- `X-XGuard-Attempt-Fee-USD: 0.03`;
- `X-XGuard-Attempt-Fee-Micro-USD: 30000`;
- `X-XGuard-Attempt-Fee-State: earned`;
- `X-XGuard-Attempt-Fee-Refundable: false`;
- `X-XGuard-Attempt-Key: <logicalPaymentKey>`.

Settlement-specific responses may additionally include `X-XGuard-Payment-Key`, `X-XGuard-Truth-State`, `X-XGuard-Truth-Endpoint`, `X-XGuard-Resolve-Endpoint`, and `X-XGuard-Release-Safe`.

## Settlement Truth Layer

A downstream response is not the same thing as independent settlement truth. XGuard therefore exposes a merchant-scoped state derived from Base evidence and recovery evidence.

States include:

- `FINALIZED`: the exact expected USDC transfer is independently proven on finalized Base state;
- `PENDING`: evidence is not yet sufficient; do not blindly resubmit the authorization;
- `PROVEN_FAILED`: evidence proves the expected settlement did not complete safely;
- `CONFLICT`: success/failure evidence disagrees and XGuard fails closed.

Read truth:

```http
GET /v1/settlements/{logicalPaymentKey}/truth
Authorization: Bearer xg_live_...
```

Request immediate re-evaluation without submitting a second settlement:

```http
POST /v1/settlements/{logicalPaymentKey}/resolve
Authorization: Bearer xg_live_...
```

Settlement truth determines **whether the expected transfer occurred**. It is intentionally separate from the earlier accepted-attempt billing event and does not retroactively refund a canonical attempt solely because downstream execution later failed.

## Failure semantics

- malformed or unsupported input fails before accepted execution;
- missing/invalid merchant authentication fails closed;
- verification does not submit value;
- settlement selects one route and does not fail over after outbound submission starts;
- a non-definitive post-submit outcome becomes ambiguous/pending and is not blindly resubmitted;
- settlement truth never converts missing evidence into success;
- insufficient XGuard service balance returns HTTP `402`;
- unhealthy, stale, or incompatible downstream routing fails closed.

## Agent interfaces

- A2A: `GET /.well-known/agent-card.json`, `POST /a2a`
- MCP: `GET /.well-known/mcp/server.json`, `POST /mcp`
- Bazaar/discovery: `GET /discovery/resources`, `GET /discovery/search`
- OpenAPI: `GET /openapi.json`

Equivalent value-producing HTTP/MCP operations should use the same configured execution class so an alternate interface does not become a billing bypass.

## Source-of-truth rule

Client integrations should not hard-code a second commercial contract. Use:

1. `/.well-known/payment-manifest` for canonical onboarding, price, billing event, network and asset;
2. `/supported` for current live x402 capability/signer information; and
3. `/openapi.json` for the live HTTP interface.
