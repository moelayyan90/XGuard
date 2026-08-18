# XGuard — Independent x402 Settlement Truth & Recovery Layer

[![CI](https://github.com/moelayyan90/XGuard/actions/workflows/ci.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/ci.yml)
[![CodeQL](https://github.com/moelayyan90/XGuard/actions/workflows/codeql.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/codeql.yml)
[![Mainnet](https://github.com/moelayyan90/XGuard/actions/workflows/deploy-mainnet.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/deploy-mainnet.yml)

## The x402 settlement truth layer

**Facilitators submit payments. XGuard independently determines what actually happened.**

XGuard is a merchant-facing settlement correctness and recovery layer for x402. It combines one-settlement ownership, replay protection, downstream facilitator routing, independent finalized Base USDC verification, and EIP-3009 ambiguity recovery so a resource server does not have to equate a facilitator response or timeout with financial truth.

For every settlement that has enough evidence, XGuard exposes one fail-closed truth state:

- `FINALIZED` — the exact expected USDC transfer is independently proven on finalized Base state; resource release is safe;
- `PENDING` — final evidence is not yet sufficient; do not blindly resubmit or call it a failure;
- `PROVEN_FAILED` — finality/recovery evidence proves the expected settlement did not complete correctly or can no longer settle;
- `CONFLICT` — success and failure evidence disagree; XGuard refuses to promote the payment to a release-safe state.

Merchants can read or actively resolve the state through:

```text
GET  /v1/settlements/{logicalPaymentKey}/truth
POST /v1/settlements/{logicalPaymentKey}/resolve
```

`/settle` also exposes `X-XGuard-Truth-State`, `X-XGuard-Truth-Endpoint`, `X-XGuard-Resolve-Endpoint`, and `X-XGuard-Release-Safe`. A downstream `success: true` can therefore coexist briefly with XGuard truth `PENDING`; only XGuard `FINALIZED` is advertised as independently release-safe.

XGuard never uses ambiguity as permission for a blind second settlement submission.

## Hosted x402 v2 gateway + agent discovery

Existing x402 resource servers do not need an XGuard-specific runtime. They can point the standard x402 facilitator client at the hosted XGuard endpoint and gain the settlement-safety and truth layer around the routed downstream facilitator.

### Live production

- **Mainnet endpoint:** `https://xguardgate.com`
- **Provider manifest:** `https://xguardgate.com/.well-known/x402/facilitator.json`
- **Settlement truth:** `/v1/settlements/{logicalPaymentKey}/truth`
- **Immediate resolver:** `/v1/settlements/{logicalPaymentKey}/resolve`
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

A resource server can call one hosted gateway instead of implementing its own settlement-safety, finality, and recovery machinery around a downstream facilitator.

XGuard adds:

- merchant-facing independent settlement truth and active ambiguity resolution;
- exact finalized Base USDC verification of payer, payee, asset, amount, and transaction evidence;
- EIP-3009 `AuthorizationUsed` / `AuthorizationCanceled` recovery for uncertain post-submit outcomes;
- permanent authorization replay identity and Payment Identifier validation;
- idempotent duplicate handling and one settlement owner under concurrency;
- no second-route settlement submission once outbound settlement has started;
- explicit prepared/started/settled/failed/ambiguous boundaries;
- facilitator health, circuit state, quarantine, latency tracking, and route controls;
- independent finalized Base USDC verification before XGuard records earned revenue;
- merchant service-balance accounting, immutable usage events, reconciliation cases, and fee reservations;
- strict parsing, capped bodies, rate limiting, concurrency limiting, structured logs, and public health/status endpoints;
- native Bazaar metadata validation, cataloging, listing, and search;
- remote MCP and machine-readable discovery surfaces for agents.

## Provider discovery

Developer tools, agents, and ecosystem catalogs can read one stable XGuard-specific provider document:

```text
GET /.well-known/x402/facilitator.json
```

Machine-readable agent discovery is also exposed through the MCP manifest, Agent Card, Agent Market metadata, OpenAPI, and `llms.txt` surfaces. Those surfaces advertise the merchant settlement-truth and resolver endpoint templates alongside Bazaar/MCP discovery.

The provider manifest is **XGuard-specific discovery metadata**. It supplements the standard x402 `/supported` endpoint; it is not represented as an x402 protocol-standard registry format.

## Start using XGuard

### 1. Check the live gateway and provider identity

```bash
curl https://xguardgate.com/healthz
curl https://xguardgate.com/readyz
curl https://xguardgate.com/supported
curl https://xguardgate.com/.well-known/x402/facilitator.json
```

A healthy production `/supported` response includes x402 v2 `exact` on `eip155:8453` and the native `bazaar` extension.

### 2. Register your service

```bash
curl -sS -X POST https://xguardgate.com/v1/register \
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
  url: "https://xguardgate.com",
  createAuthHeaders: async () => ({
    verify: headers,
    settle: headers,
    supported: headers,
    bazaar: headers,
  }),
});
```

Mainnet billing uses a prepaid XGuard **service balance**. Before the first billable settlement, create a top-up intent, send the exact native Base USDC amount to the returned treasury address, and claim the finalized deposit. See [QUICKSTART.md](QUICKSTART.md).

### 4. Use XGuard truth before treating an uncertain payment as failed

After a settlement response supplies `X-XGuard-Payment-Key`, query the merchant-scoped truth endpoint when independent finality matters:

```text
GET /v1/settlements/{logicalPaymentKey}/truth
Authorization: Bearer <XGUARD_API_KEY>
```

If it remains `PENDING`, trigger an immediate recovery/finality pass instead of resubmitting the authorization:

```text
POST /v1/settlements/{logicalPaymentKey}/resolve
Authorization: Bearer <XGUARD_API_KEY>
```

## AI-agent discovery

XGuard exposes buyer-agent payment-intent safety, x402 resource discovery, and settlement-truth capabilities through:

```text
GET /discovery/resources
GET /discovery/search?query=...
POST /mcp
GET /.well-known/mcp/server.json
GET /.well-known/agent-card.json
GET /.well-known/agent-market.json
GET /llms.txt
GET /llms-full.txt
GET /openapi.json
```

The remote MCP server exposes five current tools:

- `xguard_payment_offer` — a free pre-payment offer for a user or autonomous agent that is about to spend money; it does not execute the external payment.
- `xguard_payment_decision` — an idempotent ALLOW / REVIEW / BLOCK decision with durable evidence for a declared payment intent; it does not execute the external payment.
- `xguard_discover` — search or list cataloged paid x402 HTTP and MCP resources.
- `xguard_resource_details` — inspect one exact catalog resource.
- `xguard_status` — inspect live XGuard mainnet gateway and discovery state.

The remote server is also published in the official MCP Registry as `io.github.moelayyan90/xguard`. The repository includes a portable [Agent Skill](SKILL.md) for coding agents and payment-aware agents that need to consider XGuard before spending, inspect resource discovery, integrate or migrate an x402 resource server, or diagnose settlement truth.

A buyer agent can therefore consider XGuard when a payment intent appears, while a merchant integration can route x402 verification/settlement through XGuard. The MCP decision surface remains non-custodial with respect to the payer's external money: the actual rail/provider executes the external payment.

Bazaar catalog failure never bypasses or weakens XGuard's authoritative payment validation/settlement path.

## Billing boundary

XGuard charges only after an eligible settlement succeeds and independent Base finality confirms the expected USDC transfer.

XGuard does **not** bill malformed requests, failed verification, definitive failed settlements, unresolved ambiguous outcomes, duplicate retries representing the same logical payment, health checks, discovery queries, MCP discovery calls, or testnet traffic.

Merchant top-ups are customer prepayments, not revenue. The `$0.002` becomes gross XGuard service revenue only at the earned-finality boundary.

The settlement-truth contract is deliberately distinct from XGuard revenue recognition: independent evidence may establish `FINALIZED` before an asynchronous accounting projection has completed, without prematurely earning a service fee.

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
