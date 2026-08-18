# XGuard Quickstart

Production is `https://xguardgate.com` on Base mainnet (`eip155:8453`) using native USDC and x402 v2 `exact` EIP-3009 authorizations.

## Canonical commercial contract

XGuard charges **$0.03 (30,000 micro-USD) once per accepted authenticated economic attempt** on the protected x402 `/verify` and `/settle` path. There is no monthly subscription for this path.

The fixed attempt fee is earned only after XGuard:

1. authenticates the merchant scope;
2. parses a supported economic x402 request;
3. derives the canonical `logicalPaymentKey`; and
4. reserves the fee from the merchant's prepaid XGuard service balance.

Once accepted, the fee is earned before downstream execution. A downstream verification or settlement failure does not refund that attempt. Malformed or unauthenticated requests and idempotent retries do not add another fixed attempt fee.

Machine-readable discovery metadata such as health, readiness, `/supported`, payment manifests, agent cards and MCP discovery metadata is free. Value-producing discovery/search operations have their own SOURCE fee schedule and are not the fixed x402 attempt fee.

## 1. Discover XGuard

For agents:

```http
GET https://xguardgate.com/.well-known/payment-manifest
```

Useful discovery endpoints:

- `GET /.well-known/payment-manifest`
- `GET /.well-known/x402/facilitator.json`
- `GET /.well-known/agent-card.json`
- `GET /.well-known/mcp/server.json`
- `GET /openapi.json`
- `GET /supported`
- `GET /healthz`
- `GET /readyz`

For humans, `GET /pay` explains registration, funding and execution.

## 2. Register a merchant

```http
POST https://xguardgate.com/v1/register
Content-Type: application/json

{"name":"my-service"}
```

Store the returned `apiKey` securely. Protected endpoints use:

```http
Authorization: Bearer xg_live_...
```

## 3. Fund the prepaid XGuard balance

Create a one-time top-up intent:

```http
POST https://xguardgate.com/v1/topups/intents
Authorization: Bearer xg_live_...
Content-Type: application/json

{"amountUsd":"1.00"}
```

The response supplies a one-time `claimToken`, Base network/USDC metadata, treasury address and exact deposit amount. Send exactly that native Base USDC amount, then claim the finalized transfer:

```http
POST https://xguardgate.com/v1/topups/claim
Authorization: Bearer xg_live_...
Content-Type: application/json

{"claimToken":"...","transactionHash":"0x..."}
```

Top-ups are prepaid service liabilities, not revenue when deposited.

## 4. Verify or settle x402

Both endpoints accept the official x402 v2 facilitator envelope containing `x402Version`, `paymentPayload` and `paymentRequirements`.

```http
POST https://xguardgate.com/verify
Authorization: Bearer xg_live_...
Content-Type: application/json

{ ...x402 v2 facilitator request... }
```

```http
POST https://xguardgate.com/settle
Authorization: Bearer xg_live_...
Content-Type: application/json

{ ...x402 v2 facilitator request... }
```

An accepted attempt can include these response headers:

- `X-XGuard-Attempt-Fee-USD: 0.03`
- `X-XGuard-Attempt-Fee-Micro-USD: 30000`
- `X-XGuard-Attempt-Fee-State: earned`
- `X-XGuard-Attempt-Key: <logicalPaymentKey>`

Insufficient prepaid balance returns HTTP `402` and points to `/v1/topups/intents`.

## 5. Read settlement truth separately

Settlement truth is not the billing trigger. It is the independently verified state of the expected Base USDC transfer.

```http
GET https://xguardgate.com/v1/settlements/{logicalPaymentKey}/truth
Authorization: Bearer xg_live_...
```

A pending settlement can be re-evaluated without blind resubmission:

```http
POST https://xguardgate.com/v1/settlements/{logicalPaymentKey}/resolve
Authorization: Bearer xg_live_...
```

Truth states are `FINALIZED`, `PENDING`, `PROVEN_FAILED`, and `CONFLICT`. Only `FINALIZED` is authoritative evidence that the expected transfer completed.

## Integration rule

Treat `/.well-known/payment-manifest` as the canonical commercial/payment manifest, `/supported` as the authoritative live x402 capability response, and `/openapi.json` as the authoritative HTTP interface description. Do not hard-code a second price or billing event in client integrations.
