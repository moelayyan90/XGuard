# XGuard Action Cloud

Bounded digital tasks with one human checkout, private result recovery and signed
receipts, inside the existing XGuard Worker and domains.

- [Marketplace](https://xguardgate.com/marketplace)
- [CSV cleanup checkout](https://xguardgate.com/checkout?service=csv-clean): $2 USD,
  up to 64 KiB / 2000 rows / 40 columns; clean CSV, duplicate rows and a report.
- [Live task catalog and card readiness](https://xguardgate.com/v1/checkout/catalog)
- [Developer API](https://xguardgate.com/action/docs) / [OpenAPI](https://xguardgate.com/openapi.json)
- [Operations, market evidence and payment activation](docs/operations/action-cloud-20261116.md)

**Activation state:** this is a supporting reader release. New live card purchases
are blocked until the PayPal account is connected and a separate writer-5 release
is verified. Guest card checkout depends on PayPal eligibility. No independent
customer sale or positive realized profit has been established by the test suite.

All eligible current paid task definitions inherit the same checkout. Human card
prices have a $2 minimum; legacy x402 prices and recovery remain compatible.
Compute/GPU purchasing still requires its approved, funded upstream and does not
become available merely by connecting PayPal.



## XGuard Compute — x402 USDC inference and GPU gateway

The compute product is implemented inside the existing XGuard Worker, with
input-bound quotes, a default 25% markup, atomic prepaid spending caps,
settlement-before-execution, compatible-provider routing and signed receipts.
Provider connections are not activated without funded credentials, eligible
models/templates and applicable resale permission. Check
[production compute health](https://api.xguardgate.com/v1/compute/health) before
purchase; unavailable compute never requests payment.

- [Product](https://xguardgate.com/compute) · [Providers](https://api.xguardgate.com/v1/compute/providers)
- [JavaScript, Python, cURL and MCP examples](integrations/compute/README.md)
- [Activation requirements and current limits](docs/operations/compute-gateway-20261115.md)

Local fixture success is not a real paid canary, upstream execution or proof of
profit. Existing XGuard public facts, routing, witness and payment services
remain available through their current contracts.


**[XGuard Extract](https://xguardgate.com/extract): up to 3 public web pages → clean text, metadata, links and source evidence in one JSON result. 0.012 USDC per request, paid with x402 v2 on Base.**

Use the browser wallet checkout or `POST https://api.xguardgate.com/api/paid/v1/extract` with an `Idempotency-Key` and `{"urls":["https://example.com/"],"max_amount_atomic":"12000"}`. The initial request returns 402 without retrieving the supplied pages. A funded x402 client authorizes the exact offer, then retries the same body and key with `Payment-Signature` and `X-XGuard-Quote`.

No subscription or XGuard API key. Public HTML/text/JSON only; no browser rendering, sign-ins, search or access-control bypass. Up to 128 KiB source input and 6,000 extracted text characters per page. Partial success reports coverage; all-source failure after settlement creates an operation-specific execution credit, not an automatic cash refund. [API and recovery contract](https://xguardgate.com/openapi.json) · [JavaScript client](sdk/live-paid.js).

**The live facts layer for AI.**

Current facts. Source verified. Change tracked. Machine readable.

XGuard Live observes public primary sources and publishes compact, canonical facts with verification timestamps, source evidence and immutable history. People and machines retrieve the same data through ordinary HTTP. No account, SDK, plugin or paid API key is needed for public facts.

[Live site](https://xguardgate.com) · [Fact index](https://xguardgate.com/topics) · [Methodology](https://xguardgate.com/methodology) · [Changes](https://xguardgate.com/changes) · [Connect AI tools](https://xguardgate.com/install)

```sh
curl https://xguardgate.com/fact/npm/react/latest-version
curl -H 'Accept: text/markdown' https://xguardgate.com/fact/npm/react/latest-version
curl -H 'Accept: application/json' https://xguardgate.com/fact/npm/react/latest-version
```

A published observation includes the current or last observed value, source URL, source hash, observed/verified timestamps, freshness limit, previous value and history. STALE/UNKNOWN never imply a current verified value. Verification means a match to the source at retrieval, not independent certification of every publisher claim. Candidates remain unpublished until schema and source checks pass.

## Connect an AI client

Use [XGuard Live's MCP endpoint](https://xguardgate.com/mcp) with Streamable HTTP and call `xguard.fact.get` with `{"factId":"npm/react/latest-version"}`. Free public fact reads need no account or API key. [Install in your client](https://xguardgate.com/install) or use the [A2A agent card](https://xguardgate.com/.well-known/agent-card.json).

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

Local development uses a separate Worker config and local SQLite Durable Objects. Production smoke checks are read-only and excluded from business metrics: `npm run smoke`. The primary-source check is `node scripts/live-source-check.mjs`; robots restrictions, rate limits and changed source schemas can legitimately prevent collection.

## Operations

The production Worker is `xguard-mainnet`. Cron runs every ten minutes; persistent shard alarms collect due sources with domain limits and backoff. Cloudflare cache serves bounded, format-specific representations. `/healthz` exposes real counts and scheduler health. `/admin` requires an owner key and protects all mutations.

Deployment: use a pull request, pass CI/CodeQL, merge, then the **Deploy XGuard Live** workflow deploys the tested commit. Manual deployment with existing Cloudflare credentials: `npx --prefix apps/relay wrangler deploy --config apps/relay/wrangler.jsonc --tag git-$(git rev-parse --short=12 HEAD)`. Production lifecycle changes must first pass `node scripts/durable-object-deploy-guard.mjs <deployed-git-ref> HEAD` and be isolated from runtime changes.

See [operations and rollback](docs/live/OPERATIONS.md) and [migration inventory](docs/live/MIGRATION.md). The former execution gateway is retained solely for state/recovery compatibility and historical reference; it is not the public Live product. Historical result recovery still requires its original signed quote. Legacy marketing and release workflows are archived and do not run.

## Monetization

Launch mode is **observe**. Cloudflare Pay Per Crawl eligibility and Pay Per Use buyer participation require confirmation in the owner's Cloudflare account. The application does not fabricate revenue, simulate paid production traffic or equate crawler requests with paid use. Actual provider report imports and invoice costs are separate, auditable records. No report means unknown account revenue, not proven zero. Discovery remains free even when eligible high-value detail pages are later configured for paid retrieval.
