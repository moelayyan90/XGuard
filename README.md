# XGuard

[![CI](https://github.com/moelayyan90/XGuard/actions/workflows/ci.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/ci.yml)
[![CodeQL](https://github.com/moelayyan90/XGuard/actions/workflows/codeql.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/codeql.yml)
[![Mainnet](https://github.com/moelayyan90/XGuard/actions/workflows/deploy-mainnet.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/deploy-mainnet.yml)

**One safe route for x402 payments.** XGuard is a facilitator-compatible routing, replay-safety, accounting, and finality layer for x402 v2.

## Live services

- **Base mainnet:** `https://xguard-mainnet.maqamapp.workers.dev`
- **Base Sepolia testnet:** `https://xguard-testnet.maqamapp.workers.dev`
- **Mainnet asset:** native USDC on Base
- **Mainnet scheme:** x402 v2 `exact`, EIP-3009 authorization flow
- **Price:** `$0.002` per successful billable settlement
- **Subscription:** none

Mainnet billing is prepaid. A merchant registers for an XGuard API key, funds a one-time top-up intent with native Base USDC, claims the finalized deposit, and then uses the resulting service balance. XGuard reserves the `$0.002` service fee before settlement and earns it only after independent Base finality confirms the successful settlement. Definitive failure releases the reservation; ambiguity remains held for reconciliation. Merchant top-ups are customer prepayments, not revenue.

Testnet, malformed requests, failed verification, declined or failed settlements, ambiguous outcomes, health checks, and duplicate retries of the same payment are not billed.

## Production quickstart

Check the live gateway:

```bash
curl https://xguard-mainnet.maqamapp.workers.dev/healthz
curl https://xguard-mainnet.maqamapp.workers.dev/readyz
curl https://xguard-mainnet.maqamapp.workers.dev/supported
```

Register a merchant. The returned `apiKey` is shown once; store it as `XGUARD_API_KEY` and never commit it:

```bash
curl -sS -X POST https://xguard-mainnet.maqamapp.workers.dev/v1/register \
  -H 'Content-Type: application/json' \
  --data '{"name":"my-x402-service"}'
```

Existing x402 v2 TypeScript resource servers can use the official `HTTPFacilitatorClient` directly, so production adoption does not depend on an XGuard npm release:

```ts
import { HTTPFacilitatorClient } from "@x402/core/http";

const auth = async () => {
  const headers = {
    Authorization: `Bearer ${process.env.XGUARD_API_KEY!}`,
  };
  return { verify: headers, settle: headers, supported: headers, bazaar: headers };
};

const facilitator = new HTTPFacilitatorClient({
  url: process.env.XGUARD_URL ?? "https://xguard-mainnet.maqamapp.workers.dev",
  createAuthHeaders: auth,
});
```

Create and claim a prepaid service-balance top-up before the first billable settlement. See [Quickstart](QUICKSTART.md) for the exact API sequence.

## SDK and CLI

The SDK already supports the same bearer API-key flow:

```ts
import { createXGuardFacilitator } from "@xguard/sdk";

const facilitator = createXGuardFacilitator({
  url: "https://xguard-mainnet.maqamapp.workers.dev",
  apiKey: process.env.XGUARD_API_KEY,
});
```

The npm packages are prepared but are not claimed as published by this repository yet. Until npm publishing is activated, the official `HTTPFacilitatorClient` example above is the production path.

The migration CLI can still be executed directly from GitHub for diagnostics, testnet URL migration, and rollback:

```bash
npm exec --yes --package=typescript@5.9.3 --package=github:moelayyan90/XGuard#main -- xguard doctor --endpoint https://YOUR-PAID-ENDPOINT
npm exec --yes --package=typescript@5.9.3 --package=github:moelayyan90/XGuard#main -- xguard init --gateway https://xguard-testnet.maqamapp.workers.dev
npm exec --yes --package=typescript@5.9.3 --package=github:moelayyan90/XGuard#main -- xguard rollback
```

`xguard init` currently performs only a conservative facilitator URL migration and intentionally refuses provider-specific authentication. Do not use URL-only migration for mainnet; use the authenticated production client shown above.

## What is implemented

- x402 v2 facilitator surface: `GET /supported`, `POST /verify`, `POST /settle`.
- Base mainnet native-USDC `exact` EIP-3009 path with merchant authentication and prepaid service balance.
- Base Sepolia non-billable testnet path.
- permanent authorization replay identity plus Payment Identifier validation and settlement-layer binding/cache;
- one outbound settlement owner under concurrency, tested at 10, 100, and 1,000 simultaneous duplicates;
- verification failover where safe; no second-route settlement submission after outbound submission begins;
- explicit `OUTBOUND_PREPARED`, `OUTBOUND_STARTED`, `SETTLED`, `FAILED`, and `AMBIGUOUS` boundaries;
- measured facilitator health, circuit state, quarantine, latency tracking, and contribution filtering;
- finalized Base USDC top-up verification and independent finality verification before earned revenue;
- D1 financial projection, customer-liability separation, immutable usage events, reconciliation cases, and fee reservations;
- Cloudflare Worker + SQLite Durable Objects + D1, automated deployment, and live readiness checks;
- public status endpoints, rate limits, strict request parsing, replay protection, and structured logs.

## Financial boundary

`$0.002` is **gross XGuard service revenue** only after a settlement reaches the earned boundary. It is not automatically owner profit. Facilitator fees, infrastructure costs, reserves, refunds/liabilities, and any other operating expenses must be deducted separately.

XGuard is not an official x402, Coinbase, PayAI, Cloudflare, Base, Circle, or OKX product.

## Verify locally

```bash
npm run check
npm run verify:release
npm run smoke:live
npm run smoke:mainnet
```

The smoke checks do not submit a payment. They validate public liveness, readiness, capability, fail-closed behavior, and expected network boundaries.

## Documentation

[Quickstart](QUICKSTART.md) · [API](docs/API.md) · [OpenAPI](docs/openapi.yaml) · [Architecture](ARCHITECTURE.md) · [facilitators](docs/FACILITATORS.md) · [protocol research](docs/PROTOCOL_RESEARCH.md) · [security](SECURITY.md) · [threat model](THREAT_MODEL.md) · [pricing](PRICING.md) · [billing](BILLING.md) · [treasury](TREASURY.md) · [unit economics](UNIT_ECONOMICS.md) · [reconciliation](RECONCILIATION.md) · [payouts](PAYOUTS.md) · [deployment](DEPLOYMENT.md) · [operations](OPERATIONS.md) · [incident response](INCIDENT_RESPONSE.md)

Apache-2.0. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
