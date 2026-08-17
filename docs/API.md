# XGuard HTTP API

**Production base URL:** `https://xguardgate.com`  
**Production network:** Base mainnet native USDC, x402 v2 `exact`, EIP-3009

## Recommended x402 seller flow

1. `GET /start` — connect the merchant `payTo` wallet and sign one activation message.
2. Configure the standard x402 facilitator URL as `https://xguardgate.com`.
3. Call ordinary `/verify` and `/settle` through the x402 client with **no XGuard API key**.

No account, email, password, subscription, or prepaid XGuard balance is required for this path.

## Zero-friction endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/start` | none | One-page wallet activation |
| POST | `/v1/activate/challenge` | none | Create short-lived signed-terms challenge |
| POST | `/v1/activate` | wallet signature | Activate one merchant `payTo` |
| GET | `/v1/activate/status?payTo=...` | none | Check whether a `payTo` is activated |
| POST | `/verify` | none after activation | Verify x402 payment without submitting value |
| POST | `/settle` | none after activation | Submit one protected x402 settlement route |
| GET | `/v1/fees?payTo=...` | none | Read signed pricing and postpaid service balance |
| POST | `/v1/fees/claim` | none | Credit a finalized Base USDC service-fee payment |
| GET | `/v1/settlements/{logicalPaymentKey}/truth` | settlement-scoped | Read independent settlement truth |
| POST | `/v1/settlements/{logicalPaymentKey}/resolve` | settlement-scoped | Trigger immediate finality/recovery resolution |

`POST` bodies use `Content-Type: application/json`.

## Activation challenge

Create a challenge:

```http
POST /v1/activate/challenge
Content-Type: application/json

{"payTo":"0xMERCHANT"}
```

The response contains a short-lived nonce and the exact message that must be signed. The message includes:

- domain and Base network;
- merchant `payTo`;
- pricing version;
- XGuard fee basis points;
- per-settlement fee cap;
- postpaid limit;
- issued and expiry times;
- nonce;
- explicit non-transfer language.

Submit the signature:

```http
POST /v1/activate
Content-Type: application/json

{
  "payTo":"0xMERCHANT",
  "nonce":"0x...",
  "signature":"0x..."
}
```

XGuard verifies the signature against `payTo` before activation. The challenge is single-use and expires quickly.

## x402 request boundary

Mainnet `/verify` and `/settle` accept the official x402 v2 facilitator envelope containing:

- `x402Version`;
- `paymentPayload`;
- `paymentRequirements`.

The production boundary currently accepts:

- x402 version `2`;
- scheme `exact`;
- network `eip155:8453`;
- native Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`;
- EIP-3009 authorization flow.

Unsupported network, asset, scheme, or transfer mechanism fails before settlement routing.

## Billing boundary

The default signed x402 seller terms are:

- `50` bps = **0.5%**;
- cap `1,000` micro-USD = **$0.001** per independently finalized successful settlement;
- verify/failure/unresolved ambiguity: **$0 earned**;
- idempotent retry: no additional fee;
- default postpaid limit: **$1.00**.

The actual merchant fee is calculated from that merchant's stored signed terms:

```text
fee = min(floor(expected_finalized_amount × fee_bps / 10,000), fee_cap)
```

XGuard does not reserve or earn the zero-friction fee before finality. It does not silently subtract the fee from the buyer-authorized merchant payment.

## Settlement response headers

Zero-friction settlement responses may include:

- `X-XGuard-Auth: none-after-one-time-wallet-activation`;
- `X-XGuard-Billing: postpaid-capped-revenue-share`;
- `X-XGuard-Pricing-Version`;
- `X-XGuard-Fee-Bps`;
- `X-XGuard-Fee-Cap-USD`;
- `X-XGuard-PayTo`;
- `X-XGuard-Replayed`;
- `X-XGuard-Payment-Key`;
- `X-XGuard-Truth-State`;
- `X-XGuard-Truth-Endpoint`;
- `X-XGuard-Resolve-Endpoint`;
- `X-XGuard-Release-Safe`.

## Settlement truth

Truth states:

- `FINALIZED` — exact expected Base USDC transfer independently proven final;
- `PENDING` — insufficient final evidence;
- `PROVEN_FAILED` — final/recovery evidence proves the expected settlement failed or can no longer settle;
- `CONFLICT` — success and failure evidence disagree.

XGuard never turns missing evidence into success and never treats ambiguity as permission for a blind second settlement submission.

## Failure semantics

- unactivated `payTo` returns a clear activation-required response;
- malformed/unsupported input fails before routing;
- verification never submits value;
- postpaid limit pauses execution without requiring an upfront deposit;
- settlement has one durable owner;
- after outbound submission starts, XGuard never fails over the same authorization to a second route;
- ambiguous outcome remains unresolved until independent evidence is sufficient;
- duplicate logical payments cannot create another XGuard fee;
- rate/concurrency limits fail locally before unsafe fan-out.

## Free operations and discovery

```text
GET /
GET /healthz
GET /readyz
GET /supported
GET /status
GET /.well-known/payment-manifest
GET /.well-known/x402/facilitator.json
GET /openapi.json
GET /llms.txt
```

## Legacy authenticated endpoints

The following remain for backwards compatibility with older universal-gateway clients:

```text
POST /v1/register
GET  /v1/balance
POST /v1/topups/intents
POST /v1/topups/claim
```

They use the older bearer-key/prepaid model and are **not required** for an activated merchant that only uses XGuard as its x402 facilitator.

## Testnet

The separate Base Sepolia Worker is non-billable and explicit-only:

```text
https://xguard-testnet.maqamapp.workers.dev
```

Testnet state remains isolated from mainnet billing and settlement truth.
