# XGuard Live

**The live facts layer for AI.**

Current facts. Source verified. Change tracked. Machine readable.

XGuard Live observes public primary sources and publishes compact, canonical facts with verification timestamps, source evidence and immutable history. People and machines retrieve the same data through ordinary HTTP. No account, SDK, plugin or paid API key is needed for public facts.

[Live site](https://xguardgate.com) · [Fact index](https://xguardgate.com/topics) · [Methodology](https://xguardgate.com/methodology) · [Changes](https://xguardgate.com/changes)

```sh
curl https://xguardgate.com/fact/npm/react/latest-version
curl -H 'Accept: text/markdown' https://xguardgate.com/fact/npm/react/latest-version
curl -H 'Accept: application/json' https://xguardgate.com/fact/npm/react/latest-version
```

A published observation includes the current or last observed value, source URL, source hash, observed/verified timestamps, freshness limit, previous value and history. STALE/UNKNOWN never imply a current verified value. Verification means a match to the source at retrieval, not independent certification of every publisher claim. Candidates remain unpublished until schema and source checks pass.

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
