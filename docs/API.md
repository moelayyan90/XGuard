# XGuard HTTP API

**Mainnet base URL:** `https://xguard-mainnet.maqamapp.workers.dev`  
**Testnet base URL:** `https://xguard-testnet.maqamapp.workers.dev`  
**Mainnet mode:** Base mainnet native USDC, x402 v2 `exact`, EIP-3009 authorization

The machine-readable mainnet contract is [openapi.yaml](openapi.yaml). Current official x402 v2 types remain authoritative where the protocol evolves.

## Public mainnet endpoints

| Method | Path         | Purpose |
| ------ | ------------ | ------- |
| GET | `/` | Release, network, pricing, billing model, and endpoint discovery |
| GET | `/healthz` | Worker liveness |
| GET | `/readyz` | D1 and fresh downstream facilitator readiness |
| GET | `/supported` | Measured x402 v2 mainnet capabilities |
| GET | `/status` | Gateway/facilitator health and open reconciliation count |
| POST | `/v1/register` | Create a merchant and return a one-time API key |

## Authenticated merchant endpoints

Use `Authorization: Bearer <XGUARD_API_KEY>`.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/v1/balance` | Return available and held prepaid service balance |
| POST | `/v1/topups/intents` | Create a one-time exact native-USDC Base deposit intent |
| POST | `/v1/topups/claim` | Verify finality of a matching Base deposit and credit the merchant balance |
| POST | `/verify` | Validate a complete x402 v2 payment request without submitting value |
| POST | `/settle` | Reserve the XGuard fee and submit one safe settlement route |

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

## Settlement billing boundary

The configured XGuard service fee is `2,000` micro-USD (`$0.002`) per successful billable settlement.

The lifecycle is:

1. reserve `$0.002` from the merchant's available service balance;
2. select one healthy compatible facilitator;
3. start at most one outbound settlement submission;
4. hold the fee after a downstream success while independent Base finality is checked;
5. earn the fee only after finalized on-chain settlement is independently verified;
6. release the fee after a definitive finality failure;
7. keep ambiguity held for reconciliation without blind resubmission.

Malformed requests, verification failures, settlement failures, ambiguity, duplicate/replay retrievals, health/readiness/status traffic, and testnet activity are non-billable.

## Settlement response headers

Settlement responses may include:

- `X-XGuard-Replayed`: whether the result came from the durable replay cache;
- `X-XGuard-Payment-Key`: an immutable logical authorization correlation identity;
- `X-XGuard-Fee-State`: reservation/finality state for the XGuard service fee.

The payment key is an operational correlation value, not a bearer credential.

## Failure semantics

- malformed or unsupported input fails before routing;
- missing or invalid merchant authentication fails closed;
- verification does not submit value;
- settlement selects one route and never fails over after outbound submission starts;
- conflicting binding or an in-progress duplicate returns a conflict response;
- a non-definitive post-submit outcome becomes `AMBIGUOUS`, opens reconciliation state, and is not automatically resubmitted;
- insufficient service balance returns HTTP `402` with guidance to create a top-up intent;
- unhealthy, stale, or economically ineligible downstream routing fails closed.

## Testnet

The separate Base Sepolia Worker remains non-billable at `https://xguard-testnet.maqamapp.workers.dev`. Testnet behavior and capability are intentionally isolated from the mainnet merchant billing path.
