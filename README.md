# XGuard — High-Velocity x402 Facilitator

**One public facilitator URL in the x402 money path:**

```text
https://api.xguardgate.com
```

XGuard is a non-custodial x402 v2 facilitator gateway for AI agents and resource servers. A seller configures one facilitator URL; XGuard then selects a compatible healthy downstream settlement path per request using **scheme/network capability → health → observed latency**, with failover, durable replay protection and Base USDC timeout reconciliation.

The product is deliberately positioned **inside `/verify` and `/settle`**, not as an optional scanner beside the payment path.

## Install the XGuard agent tools

Canonical remote MCP endpoint:

```text
https://api.xguardgate.com/mcp
```

### GitHub Copilot CLI

```bash
copilot plugin install moelayyan90/XGuard
```

Or browse XGuard as a Copilot plugin marketplace:

```bash
copilot plugin marketplace add moelayyan90/XGuard
copilot plugin install xguard-x402@xguard-plugins
```

### Claude Code

```bash
claude mcp add --transport http xguard https://api.xguardgate.com/mcp
claude mcp get xguard
```

### Cursor

[Add XGuard to Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=xguard&config=eyJ4Z3VhcmQiOnsidXJsIjoiaHR0cHM6Ly9hcGkueGd1YXJkZ2F0ZS5jb20vbWNwIn19)

### Visual Studio Code / GitHub Copilot

[Install XGuard MCP in VS Code](vscode:mcp/install?%7B%22name%22%3A%22xguard%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fapi.xguardgate.com%2Fmcp%22%7D)

The repository also ships portable Agent Plugins 1.0 metadata plus native project configs for Claude/Copilot, Cursor and VS Code. See [CONNECT.md](CONNECT.md) for the complete connection matrix.

## Money-path endpoints

```text
GET  https://api.xguardgate.com/supported
POST https://api.xguardgate.com/verify
POST https://api.xguardgate.com/settle
```

A resource server that configures XGuard as its facilitator sends its x402 verification and settlement traffic through XGuard. XGuard never changes the signed x402 `payTo` or payment amount.

## Drop-in x402 seller SDK

Install directly from the public GitHub repository:

```bash
npm install github:moelayyan90/XGuard#main
```

Then use XGuard anywhere the official x402 v2 middleware expects a facilitator client:

```js
import { facilitator } from "xguard-x402-control-plane";
```

Or create an authenticated client for XGuard Usage Credits:

```js
import { createXGuardFacilitator } from "xguard-x402-control-plane";

const facilitator = createXGuardFacilitator({
  licenseKey: process.env.XGUARD_LICENSE_KEY,
});
```

The repository contains working integration examples for **Express, Hono, Next.js, paid MCP tools, Python/FastAPI, and Go/Gin** under `sdk/examples/` and `integrations/`. See [sdk/README.md](sdk/README.md).

## Automatic discovery

XGuard exposes machine-readable discovery surfaces so agents, crawlers, registries and routing libraries do not need to discover the product from the website first:

```text
GET https://api.xguardgate.com/facilitator
GET https://api.xguardgate.com/.well-known/x402
GET https://api.xguardgate.com/.well-known/x402.json
GET https://api.xguardgate.com/discovery/resources
GET https://api.xguardgate.com/discovery/search?query=...
GET https://api.xguardgate.com/v1/facilitator/route?network=eip155:8453&scheme=exact
GET https://api.xguardgate.com/supported
```

The public provider document reports current live capabilities. `batch-settlement` is advertised as live **only when a healthy configured upstream actually advertises `scheme=batch-settlement`**.

Stable public metadata:

```text
Logo:         https://xguardgate.com/logo.svg
Security:     https://xguardgate.com/.well-known/security.txt
MCP:          https://api.xguardgate.com/mcp
Agent Card:   https://api.xguardgate.com/.well-known/agent-card.json
OpenAPI:      https://api.xguardgate.com/openapi.json
LLM hints:    https://api.xguardgate.com/llms.txt
Skill:        https://api.xguardgate.com/skill.md
Website:      https://xguardgate.com
```

### DNS compatibility discovery

The repository Cloudflare workflow attempts to keep this compatibility record published:

```dns
_x402.xguardgate.com TXT "v=x402-1; wk=https://api.xguardgate.com/.well-known/x402; k=facilitator"
```

This record is **optional compatibility metadata**. If the Cloudflare token does not have Zone:DNS permission, the workflow reports `NOT PUBLISHED` rather than claiming success. The live HTTP discovery surfaces and `/supported` remain authoritative.

## Bazaar aggregation

XGuard exposes both Bazaar-style discovery surfaces:

```text
/discovery/resources
/discovery/search
```

It queries the configured facilitator catalogs, merges and de-duplicates resources, and identifies the catalog source in `xguardDiscovery`. Discovery traffic is public and does not execute a payment.

## Automatic settlement routing

XGuard sits above multiple configured x402 facilitators. For each request it:

1. parses the requested network and scheme;
2. reads current `/supported` capabilities;
3. removes incompatible routes;
4. considers route health and observed latency;
5. sends `/verify` or `/settle` through the best live compatible route;
6. freely fails over **verification** requests on retryable transport/5xx/429 errors because verification cannot spend the signed payment;
7. for **settlement**, retries a different route only when the outcome is known to be safe: explicit rate limiting, or network-specific reconciliation proves the payment was not consumed;
8. on Base USDC, checks EIP-3009 authorization state before any retry after an ambiguous settlement response;
9. on networks without reconciliation, an ambiguous timeout/5xx fails closed instead of forwarding the same signed payment to another facilitator;
10. stores durable settlement receipts to make successful replay idempotent.

Use the route-inspection endpoint without pinning the returned downstream provider:

```bash
curl 'https://api.xguardgate.com/v1/facilitator/route?network=eip155:8453&scheme=exact'
```

The configured facilitator remains XGuard even as the selected downstream route changes.

Response telemetry exposes the actual route decision:

```text
x-xguard-upstream
x-xguard-route-attempts
x-xguard-settlement-safety
server-timing
```

## High-throughput schemes

XGuard's routing is scheme-aware. It does not hard-code `exact` as the only possible scheme. If a configured live facilitator advertises `batch-settlement`, `/supported` exposes it and XGuard can route matching verification/settlement traffic to that provider.

This is intentionally different from claiming that XGuard itself owns every batch-settlement escrow/channel contract. The live advertised capability is derived from reachable providers rather than marketing text.

## Payment safety inside the route

For x402 traffic XGuard keeps:

- requirement ↔ accepted binding checks;
- Base USDC EIP-3009 recipient/value/nonce/time-window checks;
- durable replay protection;
- capability-aware multi-facilitator routing;
- fail-closed handling of ambiguous settlement state;
- Base timeout reconciliation;
- durable receipt lookup.

Receipt lookup:

```text
GET https://api.xguardgate.com/v1/receipts/{receipt_id}
```

## Billing boundary

- `/verify`: free
- failed settlements: free
- first successful settlements per `payTo`: current free allowance exposed by `/facilitator`
- successful paid settlements after the allowance: XGuard Usage Credits

Billing is attached to XGuard usage. XGuard does **not** silently divert any portion of the merchant's signed x402 transfer; the x402 recipient and amount remain bound to the payment requirements.

## Agent / robot discovery

The MCP server exposes facilitator metadata, route selection and Bazaar search directly to agents in addition to the existing safety and receipt tools. `robots.txt` and `sitemap.xml` are served by the public worker, while the provider metadata, OpenAPI, MCP and Agent Card expose machine-readable integration surfaces.

## Secondary capabilities

XGuard also retains the protocol-neutral Agent Spend Firewall, scoped spend mandates, ATS-100 safety testing and merchant edge. These are supporting capabilities; the primary financial product is now the **x402 facilitator money path**.

## Security posture

- non-custodial;
- no buyer or merchant private keys stored by XGuard;
- no mutation of signed payment amount or recipient;
- private/local proxy targets blocked;
- Base USDC recipient/amount/time-window mismatches fail closed;
- durable replay/receipt state;
- ambiguous Base authorization state is reconciled before retry;
- ambiguous settlement state on networks without a reconciliation proof fails closed instead of risking cross-facilitator duplicate settlement.
