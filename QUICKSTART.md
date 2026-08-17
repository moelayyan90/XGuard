# XGuard quickstart

For the standard x402 seller path, XGuard requires **one wallet signature once**, then only the normal facilitator URL.

- Production gateway: `https://xguardgate.com`
- Activation: `https://xguardgate.com/start`
- Protocol: x402 v2 `exact`
- Network: Base mainnet (`eip155:8453`)
- Asset: native Base USDC

## 1. Activate the merchant `payTo` once

Open:

```text
https://xguardgate.com/start
```

Connect the wallet/address your resource server advertises as `payTo` and sign the activation message.

The signed message contains the exact pricing version, service-share basis points, per-settlement cap, postpaid limit, short-lived nonce, and expiry. It proves control of `payTo`; it is **not** a token-transfer authorization.

There is no XGuard account, email, password, API key, or prepaid balance in this path.

## 2. Change one facilitator URL

```ts
import { HTTPFacilitatorClient } from "@x402/core/http";

const facilitator = new HTTPFacilitatorClient({
  url: "https://xguardgate.com",
});
```

No XGuard-specific package or auth-header callback is required for `/verify` or `/settle` after activation.

## 3. Use x402 normally

The buyer signs the ordinary x402 payment to the merchant's original `payTo`. XGuard routes and verifies the settlement without changing the signed recipient or value.

### Current zero-friction x402 pricing

| Event | XGuard fee |
| --- | ---: |
| Verify | $0 |
| Failed settlement | $0 |
| Unresolved ambiguous settlement | $0 earned |
| Idempotent retry | no additional fee |
| Independently finalized successful settlement | 0.5%, capped at $0.001 |
| Monthly subscription | none |
| Prepayment before first use | none |

The default unpaid XGuard service-fee limit is $1.00. The terms accepted during activation are stored with that merchant address.

## Settlement truth

A successful downstream response is not automatically treated as independent financial truth. XGuard exposes:

```text
GET  /v1/settlements/{logicalPaymentKey}/truth
POST /v1/settlements/{logicalPaymentKey}/resolve
```

Truth states:

- `FINALIZED`
- `PENDING`
- `PROVEN_FAILED`
- `CONFLICT`

Only `FINALIZED` means XGuard independently proved the expected Base USDC transfer final. XGuard does not blindly resubmit the same authorization after an uncertain outbound settlement.

## Fee balance and payment

Read the service-fee balance:

```bash
curl -sS 'https://xguardgate.com/v1/fees?payTo=0xYOUR_PAYTO'
```

When service fees need to be credited, send native Base USDC to the treasury returned by that endpoint and submit the finalized transaction hash:

```bash
curl -sS -X POST https://xguardgate.com/v1/fees/claim \
  -H 'Content-Type: application/json' \
  --data '{"payTo":"0xYOUR_PAYTO","transactionHash":"0xYOUR_TX_HASH"}'
```

XGuard verifies the finalized transfer before recording credit. A unique transaction/log can be credited only once.

## Free readiness and discovery

```bash
curl https://xguardgate.com/
curl https://xguardgate.com/healthz
curl https://xguardgate.com/readyz
curl https://xguardgate.com/supported
curl https://xguardgate.com/status
curl https://xguardgate.com/.well-known/payment-manifest
```

## Legacy universal-gateway endpoints

Older authenticated/prepaid routes (`/v1/register`, `/v1/topups/*`, model/tool/source/security execution and some MCP billing paths) remain for backwards compatibility. They are not part of the recommended x402 seller onboarding and are not required for `/verify` or `/settle` on an activated `payTo`.

See [Billing](BILLING.md), [Pricing](PRICING.md), and [API](docs/API.md) for the exact accounting and endpoint contract.
