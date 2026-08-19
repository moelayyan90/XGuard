# XGuard Value Harvester

[![CI](https://github.com/moelayyan90/XGuard/actions/workflows/ci.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/ci.yml)
[![CodeQL](https://github.com/moelayyan90/XGuard/actions/workflows/codeql.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/codeql.yml)
[![Mainnet](https://github.com/moelayyan90/XGuard/actions/workflows/deploy-mainnet.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/deploy-mainnet.yml)

**XGuard is a hosted value-harvesting and recovery layer. Its product boundary is not x402, a payment rail, a browser extension, or any single protocol.**

The core objective is simple:

```text
DISCOVER value that may be legally recoverable
        ↓
QUALIFY the right to claim it
        ↓
PROVE the entitlement with evidence
        ↓
CLAIM through a supported connector
        ↓
RECONCILE whether value was actually recovered
```

XGuard is designed to run as a remote service. A local installation is not required for the Value Harvester API.

## What counts as value

The core models value opportunities generically. Sources can include:

- refunds;
- service credits;
- fee refunds;
- rebates;
- overcharges;
- duplicate charges;
- settlement shortfalls;
- rewards and bounties;
- commissions and cashback;
- contractual credits;
- unclaimed balances;
- future connector-specific forms of legally recoverable value.

A payment protocol is only one possible source. x402 remains supported as an adapter and recovery source; it does not define XGuard.

## Hard boundary

XGuard must not treat money as collectible merely because it can see it.

An opportunity is not automatically eligible unless all of the following are true:

1. the right to claim is explicitly confirmed;
2. the relevant program, contract, or policy terms are confirmed;
3. supporting evidence exists;
4. expected net value is positive;
5. the claim has not expired;
6. confidence is high enough for automatic treatment, otherwise the item is held for review.

The Value Harvester does not take custody of customer funds and does not authorize taking money from unrelated accounts.

## Main Value Harvester API

Machine-readable discovery is public:

```text
GET /.well-known/xguard/value-harvester.json
GET /v1/value
GET /v1/value/capabilities
```

Private opportunity data is protected by `XGUARD_VALUE_API_KEY`:

```text
POST /v1/value/opportunities
GET  /v1/value/opportunities
GET  /v1/value/summary
POST /v1/value/opportunities/{id}/transition
```

The main counters are:

```text
FOUND
ELIGIBLE
CLAIMED
RECOVERED
```

The system deliberately distinguishes "found" from "recovered" so projected value is never reported as collected money.

## Connector model

The core is intentionally open-ended:

```text
                       XGuard Value Core
                              │
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
 cloud-credit            refund/rebate       settlement-recovery
 connectors               connectors             connectors
       │                      │                      │
       └──────────────────────┼──────────────────────┘
                              │
                     future value sources
```

A connector is responsible for source-specific discovery, evidence collection, claim execution and confirmation. The core owns eligibility, lifecycle, accounting and recovered-value truth.

Current protocol/payment code remains in the repository as connector and compatibility infrastructure while the product migrates toward this broader model.

## Existing compatibility surfaces

The repository still contains mature infrastructure that can be reused as connectors or transport layers:

- HTTP and OpenAPI;
- MCP;
- A2A;
- generic HTTP/webhook connectors;
- universal action/gateway infrastructure;
- x402 settlement safety, truth and recovery;
- browser payment-layer experiments.

These are no longer the definition of the product.

## Live public surfaces

- Website: `https://xguardgate.com`
- Value Harvester discovery: `https://xguardgate.com/.well-known/xguard/value-harvester.json` after deployment of this branch
- Protocol adapter registry: `https://xguardgate.com/.well-known/xguard/protocols.json`
- OpenAPI: `https://xguardgate.com/openapi.json`
- Remote MCP: `https://xguardgate.com/mcp`
- x402 compatibility adapter: `https://xguardgate.com/.well-known/x402/facilitator.json`
- Status: `https://xguardgate.com/status`

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

## Documentation

[Quickstart](QUICKSTART.md) · [API](docs/API.md) · [Pricing](PRICING.md) · [Billing](BILLING.md) · [Deployment](DEPLOYMENT.md)

XGuard is an independent project and is not an official product of the x402 Foundation, Coinbase, Cloudflare, Base, Circle, xpay, PayAI, OKX, Google or Microsoft.

Apache-2.0. See [CONTRIBUTING.md](CONTRIBUTING.md).
