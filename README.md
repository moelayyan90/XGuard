# XGuard

[![CI](https://github.com/moelayyan90/XGuard/actions/workflows/ci.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/ci.yml)
[![CodeQL](https://github.com/moelayyan90/XGuard/actions/workflows/codeql.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/codeql.yml)
[![Mainnet](https://github.com/moelayyan90/XGuard/actions/workflows/deploy-mainnet.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/deploy-mainnet.yml)

## Hosted x402 v2 facilitator + agent discovery

**One safe route for x402 payments.** XGuard gives x402 resource servers a hosted facilitator-compatible endpoint with replay protection, duplicate-settlement protection, settlement ownership, health-aware routing, independent Base finality verification, accounting, reconciliation, production observability, native Bazaar discovery, and a remote MCP discovery surface.

Existing x402 resource servers do not need an XGuard-specific runtime. They can point the standard x402 facilitator client at the hosted XGuard endpoint.

### Live production

- **Mainnet endpoint:** `https://xguard-mainnet.maqamapp.workers.dev`
- **Provider manifest:** `https://xguard-mainnet.maqamapp.workers.dev/.well-known/x402/facilitator.json`
- **Protocol:** x402 v2
- **Network:** Base mainnet (`eip155:8453`)
- **Asset:** Native USDC
- **Scheme:** `exact` / EIP-3009 authorization
- **XGuard fee:** **$0.002 per successful billable settlement**
- **Subscription:** **None**
- **Install:** no XGuard-specific package required
- **Discovery:** native x402 Bazaar catalog
- **Remote MCP:** Streamable HTTP at `/mcp`
- **MCP Registry name:** `io.github.moelayyan90/xguard`
- **Execution model:** routed facilitator-compatible gateway; current downstream transaction submitter is xpay

The live `/supported` response is authoritative for x402 capabilities and signer attribution. XGuard does not claim that it owns the downstream xpay signer.

The live service is continuously checked by CI, CodeQL, guarded Cloudflare deployment, readiness probes, mainnet monitoring, and dedicated agent-stack smoke checks.

## Why XGuard

A resource server can call one hosted gateway instead of implementing its own settlement-safety layer around a downstream facilitator.

XGuard adds:

- permanent authorization replay identity and Payment Identifier validation;
- idempotent duplicate handling and one settlement owner under concurrency;
- no second-route settlement submission once outbound settlement has started;
- explicit prepared/started/settled/failed/ambiguous boundaries;
- facilitator health, circuit state, quarantine, latency tracking, and route controls;
- independent finalized Base USDC verification before XGuard records earned revenue;
- merchant service-balance accounting, immutable usage events, reconciliation cases, and fee reservations;
- strict parsing, capped bodies, rate limiting, concurrency limiting, structured logs, and public health/status endpoints;
- native Bazaar metadata validation, cataloging, listing, and search;
- remote MCP tools that let agents discover cataloged paid HTTP APIs and MCP tools.

## Provider discovery

Developer tools, agents, and ecosystem catalogs can read one stable XGuard-specific provider document:

```text
GET /.well-known/x402/facilitator.json
```

It publishes the live facilitator base URL, standard `/supported`, `/verify`, and `/settle` endpoints, network, asset, scheme, integration type, pricing, onboarding endpoints, safety properties, discovery endpoints, operational endpoints, source repository, and the routed downstream attribution boundary.

This manifest is **XGuard-specific discovery metadata**. It supplements the standard x402 `/supported` endpoint; it is not represented as an x402 protocol-standard registry format.

## Start using XGuard

### 1. Check the live gateway and provider identity

```bash
curl https://xguard-mainnet.maqamapp.workers.dev/healthz
curl https://xguard-mainnet.maqamapp.workers.dev/readyz
curl https://xguard-mainnet.maqamapp.workers.dev/supported
curl https://xguard-mainnet.maqamapp.workers.dev/.well-known/x402/facilitator.json
```

A healthy production `/supported` response includes x402 v2 `exact` on `eip155:8453` and the native `bazaar` extension.

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

Mainnet billing uses a prepaid XGuard **service balance**. Before the first billable settlement, create a top-up intent, send the exact native Base USDC amount to the returned treasury address, and claim the finalized deposit. See [QUICKSTART.md](QUICKSTART.md).

## AI-agent discovery

XGuard catalogs valid Bazaar metadata carried by successful x402 traffic and exposes the resulting machine-readable catalog through:

```text
GET /discovery/resources
GET /discovery/search?query=...
POST /mcp
GET /.well-known/mcp/server.json
```

The remote MCP server exposes three read-only tools:

- `xguard_discover`
- `xguard_resource_details`
- `xguard_status`

The remote server is also published in the official MCP Registry as `io.github.moelayyan90/xguard`. The repository includes a portable [Agent Skill](SKILL.md) for coding agents that need to inspect, integrate, migrate, or diagnose an x402 resource server against XGuard.

This means an AI agent can discover paid HTTP APIs or paid MCP tools cataloged by XGuard without using a separate human-facing marketplace.

Bazaar catalog failure never bypasses or weakens XGuard's authoritative payment validation/settlement path.

## Billing boundary

XGuard charges only after an eligible settlement succeeds and independent Base finality confirms the expected USDC transfer.

XGuard does **not** bill malformed requests, failed verification, definitive failed settlements, unresolved ambiguous outcomes, duplicate retries representing the same logical payment, health checks, discovery queries, MCP discovery calls, or testnet traffic.

Merchant top-ups are customer prepayments, not revenue. The `$0.002` becomes gross XGuard service revenue only at the earned-finality boundary.

## SDK and CLI

Hosted production use does not require an XGuard package; the standard x402 `HTTPFacilitatorClient` configuration above remains the canonical integration surface.

The CLI, SDK, and core package are also published as CI-built, smoke-tested GitHub prerelease tarballs. Install the CLI directly from the verified public release:

```bash
npm install -g https://github.com/moelayyan90/XGuard/releases/download/xguard-packages-v0.1.0-alpha.0/xguard-0.1.0-alpha.0.tgz
xguard --help
xguard doctor --help
```

Install the SDK and core package without waiting for npm registry publication:

```bash
npm install \
  https://github.com/moelayyan90/XGuard/releases/download/xguard-packages-v0.1.0-alpha.0/xguard-core-0.1.0-alpha.0.tgz \
  https://github.com/moelayyan90/XGuard/releases/download/xguard-packages-v0.1.0-alpha.0/xguard-sdk-0.1.0-alpha.0.tgz
```

Release checksums are published at:

```text
https://github.com/moelayyan90/XGuard/releases/download/xguard-packages-v0.1.0-alpha.0/SHA256SUMS
```

The public npm names are prepared, but first npm publication remains identity-gated until an authorized npm credential or trusted publisher owns the packages. XGuard does not represent those npm packages as published before that happens.

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

The smoke checks validate liveness, readiness, provider identity, capabilities, fail-closed behavior, network boundaries, Bazaar discovery, MCP discovery, package build/install behavior, and public release installation. They do not fabricate a real customer payment.

## Documentation

[Quickstart](QUICKSTART.md) · [API](docs/API.md) · [OpenAPI](docs/openapi.yaml) · [facilitators](docs/FACILITATORS.md) · [Pricing](PRICING.md) · [Billing](BILLING.md) · [Treasury](TREASURY.md) · [Unit economics](UNIT_ECONOMICS.md) · [Payouts](PAYOUTS.md) · [Deployment](DEPLOYMENT.md)

## Ecosystem listing

Canonical public metadata for directories and ecosystem curators is available in [docs/ECOSYSTEM.md](docs/ECOSYSTEM.md).

XGuard is an independent project and is not an official product of the x402 Foundation, Coinbase, Cloudflare, Base, Circle, xpay, PayAI, or OKX.

Apache-2.0. See [CONTRIBUTING.md](CONTRIBUTING.md).
