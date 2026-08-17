# XGuard — x402 Settlement Truth & Recovery

[![CI](https://github.com/moelayyan90/XGuard/actions/workflows/ci.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/ci.yml)
[![CodeQL](https://github.com/moelayyan90/XGuard/actions/workflows/codeql.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/codeql.yml)
[![Mainnet](https://github.com/moelayyan90/XGuard/actions/workflows/deploy-mainnet.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/deploy-mainnet.yml)

**One merchant signature. One facilitator URL. No account, API key, subscription, or prepaid balance for the standard x402 seller path.**

XGuard is a facilitator-compatible safety layer for x402 v2 on Base mainnet. It routes settlement through a downstream facilitator while independently checking what actually happened on-chain before it treats a payment as final.

## Start in under a minute

### 1. Activate the merchant `payTo` wallet once

Open:

```text
https://xguardgate.com/start
```

Connect the same wallet/address your x402 resource advertises as `payTo` and sign one activation message. The message contains the exact XGuard pricing terms and a short-lived nonce.

The activation signature:

- proves control of `payTo`;
- accepts the disclosed XGuard service terms;
- does **not** authorize a token transfer;
- does **not** change the payment recipient;
- creates no password, API key, or custodial wallet.

### 2. Point the standard x402 client at XGuard

```ts
import { HTTPFacilitatorClient } from "@x402/core/http";

const facilitator = new HTTPFacilitatorClient({
  url: "https://xguardgate.com",
});
```

That is the XGuard-specific runtime integration. No XGuard package or authorization header is required for `/verify` or `/settle` after the merchant `payTo` has been activated.

### 3. Keep using x402 normally

The buyer still signs the ordinary x402 `exact` payment to the merchant's original `payTo`. XGuard does not silently rewrite the recipient or reduce the buyer-authorized merchant amount.

## Pricing

The zero-friction x402 seller contract is:

- **0.5%** of each independently finalized successful settlement;
- **maximum $0.001** XGuard fee per settlement;
- `/verify`: **$0**;
- failed settlement: **$0**;
- ambiguous outcome while unresolved: **$0 earned**;
- idempotent retry: **no additional fee**;
- subscription: **none**;
- prepaid balance before first use: **none**.

The signed activation stores a pricing version, fee basis points, per-settlement cap, and postpaid limit for that merchant address. XGuard does not silently replace those signed terms with a different price.

Because x402 `exact` binds the recipient and value signed by the buyer, the XGuard fee is a **separate postpaid service receivable**. It is not skimmed from the merchant's buyer payment. This preserves the buyer-authorized transfer exactly.

The current default postpaid limit is **$1.00 of unpaid XGuard service fees**. When that limit is reached, XGuard pauses further protected execution for that activated `payTo` until service fees are credited.

See [Pricing](PRICING.md) and [Billing](BILLING.md).

## What XGuard adds

A resource server can use the ordinary x402 facilitator interface while XGuard adds:

- durable one-settlement ownership under concurrency;
- replay and Payment Identifier binding;
- no blind second settlement after an ambiguous submission;
- independent finalized Base USDC verification of payer, payee, asset and amount;
- EIP-3009 ambiguity recovery using authorization evidence;
- explicit settlement truth states;
- bounded parsing, rate limiting and concurrency limiting;
- downstream health and route controls;
- immutable settlement/accounting events.

## Settlement truth

XGuard exposes one of four states when enough evidence exists:

- `FINALIZED` — the exact expected Base USDC transfer is independently proven final;
- `PENDING` — final evidence is not sufficient yet;
- `PROVEN_FAILED` — final/recovery evidence proves the expected settlement did not complete correctly or can no longer settle;
- `CONFLICT` — success and failure evidence disagree, so XGuard fails closed.

```text
GET  /v1/settlements/{logicalPaymentKey}/truth
POST /v1/settlements/{logicalPaymentKey}/resolve
```

For an activated zero-friction merchant these endpoints are correlated to XGuard-owned settlement records without requiring a merchant API key. A pending/ambiguous state is never permission for a blind second submission.

## Fee status

Read the postpaid service balance for an activated merchant:

```text
GET /v1/fees?payTo=0x...
```

Credit a finalized Base USDC service-fee payment:

```text
POST /v1/fees/claim
Content-Type: application/json

{
  "payTo": "0x...",
  "transactionHash": "0x..."
}
```

The transaction is independently checked against the XGuard treasury before credit is recorded, and the same transfer log cannot be credited twice.

## Production contract

- **Endpoint:** `https://xguardgate.com`
- **Protocol:** x402 v2
- **Network:** Base mainnet (`eip155:8453`)
- **Asset:** native Base USDC
- **Scheme:** `exact`
- **Authorization mechanism:** EIP-3009
- **Current downstream transaction submitter:** xpay
- **Provider manifest:** `https://xguardgate.com/.well-known/x402/facilitator.json`
- **Payment manifest:** `https://xguardgate.com/.well-known/payment-manifest`
- **Activation:** `https://xguardgate.com/start`

The live `/supported` response is authoritative for protocol capability and signer attribution. XGuard does not claim ownership of the downstream xpay signer.

## Discovery and agent surfaces

XGuard also exposes:

```text
GET /.well-known/x402/facilitator.json
GET /.well-known/payment-manifest
GET /.well-known/mcp/server.json
GET /.well-known/agent-card.json
GET /.well-known/agent-market.json
GET /openapi.json
GET /llms.txt
POST /mcp
```

The MCP/discovery surfaces are useful for discovery; they are not a substitute for putting XGuard in the resource server's facilitator path.

## Legacy universal-gateway compatibility

The repository still contains older authenticated/prepaid gateway surfaces such as `/v1/register`, `/v1/topups/*`, model/tool/source/security execution and some MCP billing paths. They remain for compatibility and are **not required** to use XGuard as the standard x402 facilitator.

New x402 seller integrations should use the one-signature activation path above rather than creating an XGuard API key or prepaid service balance.

## SDK and CLI

Hosted x402 production use does not require an XGuard package. The standard `HTTPFacilitatorClient` configuration above is the canonical integration.

CI-built prerelease tarballs for the CLI/SDK/Core are available through GitHub Releases for migration and diagnostics. Public npm names must not be described as published until registry publication is independently verified.

## Security and operations

- [Security policy](SECURITY.md)
- [Threat model](THREAT_MODEL.md)
- [Architecture](ARCHITECTURE.md)
- [Incident response](INCIDENT_RESPONSE.md)
- [Operations](OPERATIONS.md)
- [Reconciliation](RECONCILIATION.md)

Local verification:

```bash
npm run check
npm run verify:release
npm run smoke:live
npm run smoke:mainnet
```

Smoke tests validate behavior but do not fabricate customer transactions.

## Documentation

[Quickstart](QUICKSTART.md) · [API](docs/API.md) · [facilitators](docs/FACILITATORS.md) · [Pricing](PRICING.md) · [Billing](BILLING.md) · [Deployment](DEPLOYMENT.md)

XGuard is independent infrastructure. It is not an official product of the x402 Foundation, Coinbase, Cloudflare, Base, Circle, xpay, PayAI, or OKX.

Apache-2.0. See [CONTRIBUTING.md](CONTRIBUTING.md).
