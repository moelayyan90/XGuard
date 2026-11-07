# Agent402 production recovery — 2026-11-07

## Pre-change rollback point

- Git main: `55063ed3f5dbc8f9c980df935b8e735b7c1f12dc`.
- Preserved Git branch: `rollback/agent402-20261107`.
- Worker: `xguard-mainnet`.
- Active version: `d802f37f-5d88-4627-994c-c2b064b1db7e` at 100%.
- Deployment: `f66aec50-fe33-4e13-8440-278b78f8e877`.
- Custom domains: `xguardgate.com`, `www.xguardgate.com`, `api.xguardgate.com`; all point to `xguard-mainnet` production.
- Worker dashboard lists no wildcard routes. The token's zone-route read returned 403; the signed-in dashboard separately confirmed the custom-domain mapping and empty Routes list.
- Snapshot evidence: https://github.com/moelayyan90/XGuard/actions/runs/42363123725

## Root cause

`src/live/worker.ts` canonicalized both www and api hosts to the apex with HTTP 308. `src/live-entry.js` served newer paid/MCP routes but never dispatched `/supported`, `/verify` or `/settle` to the existing relay. The Live discovery document described only extraction and `/identity` returned generic product JSON without an operator.

Cloudflare already maps the API hostname to the correct Worker, so no DNS/domain/route mutation is required.

## Restored contract

- `/supported`: direct JSON with numeric x402Version 2, exact, eip155:8453; no claimed local signer.
- x402 discovery aliases: facilitator role, canonical endpoints, operator/contact and repository.
- `/verify` and `/settle`: bounded JSON validation before upstream or durable financial access; valid Base exact requests use the existing relay verification, quota and durable receipt path. Existing settlement state and secret settings remain in place.
- `/identity`: server-rendered public operator HTML; negotiated JSON identity retained for existing operational consumers.
- Public OpenAPI, llms.txt, Live manifest and MCP server manifest describe the current gateway role while preserving existing product descriptions.

The configured `https://facilitator.xpay.sh/supported` was checked externally before changes and advertises `{ "x402Version": 2, "scheme": "exact", "network": "eip155:8453" }`. XGuard is a non-custodial compatibility gateway, not a claim to operate that upstream's signer. Production acceptance tests use only unsigned invalid payloads and perform no payment.

## Verification and recovery

`npm run check`, `npm test`, `npm run build`, `node apps/relay/test/agent402-workerd.mjs`, existing financial-safety tests, and the full CI compare against the pre-change revision. `node scripts/agent402-smoke.mjs` is a mandatory post-deployment production check.

If production acceptance fails, the existing compatible-code deployment workflow rolls back. Manual rollback using the existing authorized Cloudflare deployment credentials:

```sh
npx wrangler@4.147.0 rollback d802f37f-5d88-4627-994c-c2b064b1db7e --yes --config apps/relay/wrangler.jsonc --message 'Restore Agent402 pre-change version'
```

No Durable Object schema, binding, migration, payTo, private key or settlement secret is changed by this repair. Git rollback alone does not change the active Worker; verify deployment and public responses after recovery.
