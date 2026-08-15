# XGuard

[![CI](https://github.com/moelayyan90/XGuard/actions/workflows/ci.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/ci.yml)
[![CodeQL](https://github.com/moelayyan90/XGuard/actions/workflows/codeql.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/codeql.yml)
[![Mainnet](https://github.com/moelayyan90/XGuard/actions/workflows/deploy-mainnet.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/deploy-mainnet.yml)

## Hosted safety gateway for x402 v2

**One safe route for x402 payments.** XGuard gives x402 resource servers a hosted facilitator-compatible endpoint with replay protection, duplicate-settlement protection, settlement ownership, health-aware routing, independent Base finality verification, accounting, reconciliation, and production observability.

**No XGuard software needs to be installed on the resource server.** Existing x402 clients can point their facilitator configuration at the hosted XGuard endpoint.

### Live production

- **Mainnet endpoint:** `https://xguard-mainnet.maqamapp.workers.dev`
- **Protocol:** x402 v2
- **Network:** Base mainnet (`eip155:8453`)
- **Asset:** Native USDC
- **Scheme:** `exact` / EIP-3009 authorization
- **XGuard fee:** **$0.002 per successful billable settlement**
- **Subscription:** **None**
- **Current downstream route:** xpay
- **Configured downstream facilitator fee:** **$0**

The live service is continuously checked by CI, CodeQL, guarded Cloudflare deployment, readiness probes, and live Mainnet monitoring.

## Why XGuard

A resource server can call one hosted gateway instead of implementing its own settlement-safety layer around a downstream facilitator.

XGuard adds:

- permanent authorization replay identity and Payment Identifier validation;
- idempotent duplicate handling and one settlement owner under concurrency;
- no second-route settlement submission once outbound settlement has started;
- explicit `OUTBOUND_PREPARED`, `OUTBOUND_STARTED`, `SETTLED`, `FAILED`, and `AMBIGUOUS` boundaries;
- facilitator health, circuit state, quarantine, latency tracking, and route controls;
- independent finalized Base USDC verification before XGuard records earned revenue;
- merchant service-balance accounting, immutable usage events, reconciliation cases, and fee reservations;
- rate limiting, strict parsing, capped bodies, structured logs, and public health/status endpoints.

## Start using XGuard

### 1. Check the live gateway

```bash
curl https://xguard-mainnet.maqamapp.workers.dev/healthz
curl https://xguard-mainnet.maqamapp.workers.dev/readyz
curl https://xguard-mainnet.maqamapp.workers.dev/supported
```

### 2. Register your service

```bash
curl -sS -X POST https://xguard-mainnet.maqamapp.workers.dev/v1/register \
  -H 'Content-Type: application/json' \
  --data '{"name":"my-x402-service"}'
```

The returned API key is shown once. Store it as `XGUARD_API_KEY` and never commit it.

### 3. Point the standard x402 facilitator client at XGuard

```ts
import { HTTPFacilitatorClient } from "@x402/core/http";

const headers = {
  Authorization: `Bearer ${process.env.XGUARD_API_KEY!}`,
};

const facilitator = new HTTPFacilitatorClient({
  url: "https://xguard-mainnet.maqamapp.workers.dev",
  createAuthHeaders: async () => ({
    verify: headers,
    settle: headers,
    supported: headers,
    bazaar: headers,
  }),
});
```

Mainnet billing uses a prepaid XGuard **service balance**. Before the first billable settlement, create a top-up intent, send the exact native Base USDC amount to the returned treasury address, and claim the finalized deposit. See [QUICKSTART.md](QUICKSTART.md) for the exact API sequence.

## Billing boundary

XGuard charges only after an eligible settlement succeeds and independent Base finality confirms the expected USDC transfer.

XGuard does **not** bill malformed requests, failed verification, declined or failed settlements, ambiguous outcomes, duplicate retries representing the same payment, health checks, or testnet traffic.

Merchant top-ups are customer prepayments, not revenue. The `$0.002` becomes gross XGuard service revenue only at the earned-finality boundary. Operating costs, liabilities, reserves, and any other expenses remain separate from owner-distributable profit.

## Downstream routing

The current production settlement route is **xpay**. XGuard remains the merchant-facing facilitator-compatible safety/routing layer; xpay is the current downstream transaction submitter. The route can be changed without changing the public XGuard integration surface.

## SDK and CLI

The repository contains an XGuard SDK and migration CLI, but production use does **not** depend on installing them. The standard x402 `HTTPFacilitatorClient` configuration above is the supported hosted path today.

The XGuard npm packages are prepared but are not represented as published until registry publication is actually completed.

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

The smoke checks validate liveness, readiness, capabilities, fail-closed behavior, and network boundaries. They do not fabricate a real customer payment.

## Documentation

[Quickstart](QUICKSTART.md) · [API](docs/API.md) · [OpenAPI](docs/openapi.yaml) · [facilitators](docs/FACILITATORS.md) · [Pricing](PRICING.md) · [Billing](BILLING.md) · [Treasury](TREASURY.md) · [Unit economics](UNIT_ECONOMICS.md) · [Payouts](PAYOUTS.md) · [Deployment](DEPLOYMENT.md)

## Ecosystem listing

Canonical public metadata for directories and ecosystem curators is available in [docs/ECOSYSTEM.md](docs/ECOSYSTEM.md).

XGuard is an independent project and is not an official product of the x402 Foundation, Coinbase, Cloudflare, Base, Circle, xpay, or OKX.

Apache-2.0. See [CONTRIBUTING.md](CONTRIBUTING.md).
