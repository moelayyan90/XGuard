# XGuard

**One safe route for x402 payments.** XGuard is a testnet-first, facilitator-compatible routing and safety layer for x402 v2. A resource server integrates once; XGuard filters routes by capability, health, latency, reliability, and known cost, then prevents unsafe settlement retries.

**Price:** `$0.002` per successful billable settlement. There is no monthly subscription. Testnet, malformed requests, failed verification, declined or failed settlements, ambiguous outcomes, health checks, and duplicate retries of the same payment are not billed. Any downstream facilitator, chain, funding, or off-ramp cost is separate.

## Adopt or remove

After the alpha CLI is published, the intended migration is:

```bash
npx xguard@next init --gateway https://xguard-testnet.maqamapp.workers.dev
npx xguard@next doctor --endpoint https://YOUR-TESTNET-PAID-ENDPOINT
npx xguard@next rollback
```

The npm package is prepared but **not published** in this workspace. The equivalent local commands are:

```bash
npm install
npm run build
node packages/cli/dist/bin.js init --gateway http://127.0.0.1:8787
node packages/cli/dist/bin.js doctor
node packages/cli/dist/bin.js rollback
```

`init` uses the TypeScript parser to change only a literal `url` inside `new HTTPFacilitatorClient({...})`. It refuses configurations that contain provider-specific authentication, backs up every changed file, records before/after hashes without printing the former credential-bearing URL, runs the existing test script, and automatically rolls back a failing migration. It never reads private keys or uploads source.

For a manual drop-in change:

```ts
import { createXGuardFacilitator } from "@xguard/sdk";

const facilitator = createXGuardFacilitator({
  url: process.env.XGUARD_URL!,
  apiKey: process.env.XGUARD_API_KEY,
});
```

The client implements the official `FacilitatorClient` interface, so existing x402 resource-server code can usually keep the rest of its integration.

## What is implemented

- x402 v2 facilitator surface: `GET /supported`, `POST /verify`, `POST /settle`.
- Exact EVM authorization validation for EIP-3009 and Permit2; Base Sepolia is the enabled release network.
- Permanent authorization replay identity plus Payment Identifier validation and settlement-layer binding/cache. The merchant still owns the official end-to-end resource-response cache.
- One outbound settlement owner under concurrency; tested at 10, 100, and 1,000 simultaneous duplicates.
- Conservative failover: verification may try another compatible route; settlement never tries a second route after submission begins.
- Explicit `OUTBOUND_PREPARED`, `OUTBOUND_STARTED`, `SETTLED`, `FAILED`, and `AMBIGUOUS` boundaries.
- Health/capability routing, EWMA measurements, circuit states, quarantine, and non-negative contribution filtering.
- Exact integer micro-USD accounting on the billable Node ledger, immutable usage events, double-entry postings, customer-liability separation, reserve and fail-closed payout policy.
- Cloudflare Worker + SQLite Durable Object coordinator + D1 projection/outbox, with a Node/SQLite reference gateway.
- Public status and SSRF-safe compatibility checker, Prometheus-format Node metrics, structured logs, backup and reconciliation jobs.
- Official x402 MCP paid-tool example and Bazaar-ready starter metadata.

## Release status

This is `0.1.0-alpha.0`, **testnet only**. The public testnet Worker is live at [xguard-testnet.maqamapp.workers.dev](https://xguard-testnet.maqamapp.workers.dev). A real x402 Base Sepolia flow has completed from `402` through signed payment, `/verify`, `/settle`, HTTP `200`, and confirmed onchain USDC transfer. Testnet billing remains disabled: actual XGuard revenue, treasury, and owner payout activity are all `$0.00`.

XGuard is not an official x402 or Coinbase product. Mainnet remains hard-disabled until the legal, security, reconciliation, operational, funding, provider, and independent-finality gates in [DEPLOYMENT.md](DEPLOYMENT.md) are satisfied.

## Verify locally

```bash
npm run check
npm run verify:release
npm run smoke:live
node apps/gateway/dist/demo.js
```

The demo is explicitly a deterministic protocol simulation: it broadcasts no chain transaction and charges no fee. The live smoke command also submits no payment; it checks readiness, compatibility, reconciliation status, malformed-input rejection, and the mainnet hard gate. See [reports/TEST_RESULTS.md](reports/TEST_RESULTS.md) for executed evidence and [docs/EXTERNAL_BLOCKERS.md](docs/EXTERNAL_BLOCKERS.md) for the remaining actions that require authenticated or regulated third parties.

## Documentation

[Quickstart](QUICKSTART.md) · [API](docs/API.md) · [OpenAPI](docs/openapi.yaml) · [Architecture](ARCHITECTURE.md) · [facilitators](docs/FACILITATORS.md) · [protocol research](docs/PROTOCOL_RESEARCH.md) · [security](SECURITY.md) · [threat model](THREAT_MODEL.md) · [pricing](PRICING.md) · [billing](BILLING.md) · [treasury](TREASURY.md) · [unit economics](UNIT_ECONOMICS.md) · [reconciliation](RECONCILIATION.md) · [payouts](PAYOUTS.md) · [deployment](DEPLOYMENT.md) · [operations](OPERATIONS.md) · [incident response](INCIDENT_RESPONSE.md)

Apache-2.0. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
