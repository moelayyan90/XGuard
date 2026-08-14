# Deployment

XGuard is testnet-only. The lowest-cash deployment candidate is the prepared Cloudflare Worker because a payment-key Durable Object serializes settlement ownership and D1 stores the operational projection. The portable Node gateway is useful for local testing and a single-instance testnet deployment.

## Local testnet

Requirements: Node.js 22 or newer.

```bash
npm ci --ignore-scripts
npm run check
cp .env.example .env
npm run build
node apps/gateway/dist/server.js
```

`GET /healthz` proves process liveness. `GET /readyz` additionally requires the financial database and at least one current compatible facilitator capability. A green health check alone is not settlement readiness.

For Docker, populate `XGUARD_API_KEY_PEPPER` through the host's secret mechanism and run `docker compose up --build`. The container is non-root, read-only, capability-dropped, and persists SQLite only in its named volume.

## Live Cloudflare testnet

The checked-in `apps/worker/wrangler.jsonc` is a public-safe template and contains no account-specific identifiers or secret values. This working copy keeps the authorized testnet bindings in ignored `apps/worker/wrangler.local.jsonc`. The deployed endpoint is `https://xguard-testnet.maqamapp.workers.dev`. Reproduce and verify this deployment from the authorized working copy with:

```bash
npm --workspace @xguard/worker run types -- --check
npx wrangler d1 migrations apply xguard-testnet --remote --config apps/worker/wrangler.local.jsonc
npx wrangler deploy --config apps/worker/wrangler.local.jsonc
npm run smoke:live
```

Any future facilitator credential must be added with `wrangler secret put` and referenced by name. Never place it in the configuration or repository. The live smoke check performs no payment and verifies `/healthz`, `/readyz`, `/supported`, `/status`, malformed-input rejection, and the mainnet hard gate.

The Worker, SQLite Durable Objects, D1 projection, rate limits, and five-minute health cron are deployed. A real Base Sepolia x402 request completed `402 -> signed payment -> /verify -> /settle -> HTTP 200`, and the USDC transfer was independently confirmed through the public Base Sepolia RPC. Three earlier settlements whose Worker RPC response hit `DataCloneError` were reconciled only after matching their immutable payment records to successful onchain transfers; all three cases are resolved and the live open-reconciliation count is zero. No bill or fee was created.

## Mainnet release gate

Mainnet remains disabled until all of the following evidence exists:

- current Jordan legal classification and any required entity/license approval;
- a regulated, contractually authorized facilitator and billing/funding rail;
- repeated Base Sepolia release-candidate settlement and replay evidence after any settlement-path change;
- critical/high security findings closed and dependency audit current;
- permanent replay, 1,000-way duplicate, settlement-boundary, restore, and reconciliation tests passing;
- production PostgreSQL or another reviewed transactional multi-instance source of truth;
- verified alerts, backups, restore exercise, runbooks, on-call ownership, rate limits, and DDoS controls;
- fee, downstream cost, merchant liability, reserve, and payout accounting reconciled;
- every enabled route has current capabilities and non-negative unit economics.

The edge Worker hard-rejects non-testnet networks in code. The Node gateway also throws whenever `XGUARD_MAINNET_ENABLED=true`; the former self-attested `APPROVED` environment strings cannot enable it. The reusable core requires a chain-finality adapter, but this repository ships no production implementation. Mainnet enablement therefore requires a reviewed code release, not a configuration shortcut.

See [external blockers](docs/EXTERNAL_BLOCKERS.md) for the smallest authenticated or regulated actions still unavailable to this environment.
