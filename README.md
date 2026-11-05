# XGuard

**Commercial machine-readable intelligence and transaction infrastructure for AI agents.**

XGuard turns continuously verified public-source observations into structured facts, change history, evidence, and machine-consumable retrieval paths for autonomous software.

**Discovery is open. High-value retrieval is commercial.**

[Open XGuard](https://xguardgate.com) · [Browse facts](https://xguardgate.com/topics) · [Changes](https://xguardgate.com/changes) · [Methodology](https://xguardgate.com/methodology) · [Connect an AI client](https://xguardgate.com/install)

---

## What XGuard sells

XGuard is designed to monetize machine demand for current, source-backed information and execution infrastructure.

The commercial surface is built around:

- **Verified facts** — current or last-observed values with source and verification metadata.
- **Change intelligence** — machine-readable change history for tracked entities and software packages.
- **Evidence** — source-linked evidence associated with observations.
- **Agent retrieval** — HTTP, MCP and A2A access for autonomous clients.
- **Paid retrieval paths** — high-value resources can route buyers through XGuard checkout before full delivery.
- **Gateway infrastructure** — XGuard can sit between an automated buyer and a protected operation, applying pricing, payment requirements, verification and auditable delivery.

XGuard is not intended to depend on subscriptions, SDK installation, sales calls, or manual fulfillment. The buyer can discover a resource, determine its price, pay when required, and retrieve it programmatically.

---

## Buyer flow

```text
Discover resource
      ↓
Preview / metadata
      ↓
Request high-value resource
      ↓
Checkout / payment requirement
      ↓
Payment verification
      ↓
Authorized retrieval or execution
      ↓
Evidence / receipt / audit trail
```

A successful HTTP response is **not** treated as proof of payment. Paid delivery is only considered paid when the corresponding payment and verification state confirms it.

---

## Public discovery

Public discovery exists so search engines, AI crawlers, agents, developers and automated systems can find XGuard resources.

Example:

```sh
curl https://xguardgate.com/fact/npm/react/latest-version
curl -H 'Accept: application/json' https://xguardgate.com/fact/npm/react/latest-version
```

Discovery and previews may remain publicly accessible. That does **not** imply that every detailed resource, evidence record, history view or protected operation is permanently free.

---

## Commercial checkout

XGuard exposes a checkout route for machine-discovered facts and protected resources.

Example:

```text
/api/gateway/v1/checkout?fact=/fact/npm/<package>/latest-version
```

The checkout response is the authoritative place for the current commercial terms of that resource. Prices, payment rails, eligibility and settlement behavior may vary by resource and production configuration.

XGuard does not count crawlers, previews, checkout views or ordinary HTTP traffic as revenue. Revenue is recognized only from verified paid transactions.

---

## AI-agent access

### MCP

Use the XGuard MCP endpoint:

```text
https://xguardgate.com/mcp
```

Example tool request:

```json
{
  "factId": "npm/react/latest-version"
}
```

### A2A

Agent discovery is available through:

```text
https://xguardgate.com/.well-known/agent-card.json
```

### HTTP

XGuard resources are addressable over ordinary HTTPS, making them usable by agents, crawlers, backend services and browser-based clients without a proprietary SDK.

---

## Data integrity

A published observation may include:

- current or last observed value
- source URL
- source hash
- observed and verified timestamps
- freshness limit
- previous value
- immutable or append-only history where applicable
- associated evidence

`STALE` and `UNKNOWN` never imply a currently verified value.

Verification means that XGuard matched the observation to its source at retrieval time. It is not an independent certification of every claim made by the upstream publisher.

---

## Why XGuard exists

AI agents increasingly need information that is:

- current
- machine-readable
- attributable to a primary source
- change-aware
- independently retrievable
- suitable for automated purchasing
- auditable after delivery

XGuard is being built as the commercial layer between that machine demand and verified data or protected execution.

---

## Integration targets

XGuard is designed for:

- AI agents
- MCP clients
- A2A-compatible systems
- autonomous research systems
- developer tools
- CI/CD and security automation
- software supply-chain monitoring
- data pipelines
- agentic commerce

Current repository topics include `agentic-ai`, `ai-agent-security`, `api-security`, `mcp`, `x402`, `credential-broker`, `proofrail` and `cloudflare-workers`.

---

## Operations

Production runs on Cloudflare Workers with persistent state where required.

The production Worker is:

```text
xguard-mainnet
```

Operational controls include health checks, scheduler state, source verification, bounded caching, owner-protected administrative mutations and deployment checks.

Production changes should pass CI and security checks before deployment.

See:

- [Operations and rollback](docs/live/OPERATIONS.md)
- [Migration inventory](docs/live/MIGRATION.md)

---

## Development

Use Node 24.

```sh
npm ci --prefix apps/relay
npm run check
npm test
npm run build
npm run --prefix apps/relay live:test-runtime
npm run dev
```

Production smoke checks are read-only:

```sh
npm run smoke
```

Primary-source validation:

```sh
node scripts/live-source-check.mjs
```

---

## Commercial principle

**Free discovery should create demand; it should not accidentally give away the entire commercial product.**

The intended separation is:

```text
Discovery / indexing / preview       → open
High-value detail / evidence         → commercially controllable
Protected execution                  → payment-gated where configured
Verified paid delivery               → auditable
```

XGuard's objective is not traffic for its own sake. The objective is to convert legitimate machine demand into verified, measurable transactions while preserving enough public discovery for the market to find the product.

---

## Live service

**https://xguardgate.com**
