# Changelog

All notable changes follow Keep a Changelog concepts. Versions use semantic versioning; alpha releases are not production guarantees.

## 0.1.0-alpha.0 - Unreleased

### Added

- x402 v2 exact-EVM gateway surface and Base Sepolia compatibility boundary.
- strict authorization binding, permanent replay identity, Payment Identifier handling, concurrency serialization, and ambiguity-safe settlement.
- health/capability/cost-aware routing with circuit states and verify-only failover.
- immutable micro-USD usage ledger, prepaid balance holds, double-entry treasury, reserve, payout safety, and reconciliation.
- Cloudflare Worker/Durable Object/D1 candidate plus portable Node/SQLite gateway.
- migration/rollback CLI, doctor, SDK, starter, MCP example, status page, checker, metrics, CI, security automation, and required documentation.

### Security

- bounded streaming request/response parsing, DNS-pinned public-address SSRF defenses, redirect rejection, strict facilitator response validation, secret scanning, non-root container, CodeQL, Dependabot, and adversarial/concurrency tests.
- Permit2 replay identity is scoped to owner and nonce; the exact proxy, authorization method, signatures, monetary bounds, and request/payment binding are enforced.
- settlement ownership expires safely before submission, while stale or uncertain post-submission work becomes `AMBIGUOUS` and is never blindly retried.
- mainnet is compile-time/release disabled in both shipped gateways; the reusable core additionally requires independent finality evidence before recognizing and billing settlement success.
- owner-payout preparation re-evaluates safety atomically, reserves destination plus provider fee, rejects unresolved reconciliation, and records immutable terminal provider evidence.
- Worker facilitator requests use manual redirect handling, and settlement results are converted to strict JSON data before Durable Object RPC finalization; permanent Workers-runtime regressions cover both defects.
- local `.xguard*.env` test-wallet files are ignored by Git/Docker and excluded from value scanning output while tracked-secret detection remains fail-closed.

### Changed

- `/supported`, doctor, and the public checker now advertise only measured x402 v2 exact-EVM capabilities and distinguish facilitator features from resource-server extensions.
- official mixed v1/v2 facilitator capability responses are accepted while only compatible v2 routes are retained.
- the migration CLI refuses credential-bearing facilitator configurations, validates the gateway URL, preserves rollback data locally, and never prints the previous facilitator URL.

### Deployed testnet evidence

- `xguard-testnet.maqamapp.workers.dev` is live on Cloudflare Workers Free with D1 and SQLite Durable Objects.
- a real signed x402 Base Sepolia flow completed through HTTP `200` and confirmed USDC settlement onchain.
- historical `DataCloneError` ambiguity records were matched to successful chain evidence and resolved; testnet produced no billing or revenue.

### Known release boundary

- Testnet-only and unpublished to GitHub/npm. No live off-ramp or mainnet facilitator is active; mainnet remains hard-disabled.
