# Operations

XGuard production operations are centered on the `xguard-mainnet` Cloudflare Worker. Normal traffic is designed to require no owner processing. Financial ambiguity is the exception: automation quarantines it and waits for independent evidence rather than risking a second transfer.

| Cadence / trigger               | Implemented automatic action                                                                 | Failure behavior                                |
| ------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| every request                   | structured request/latency/result metrics; no raw payment body                               | sanitized error and request ID                  |
| every minute on mainnet Worker  | refresh facilitator health; expire stale payment IDs/top-up intents; process finality jobs    | degrade/open/quarantine route or reconciliation |
| every 5 minutes on mainnet Worker | scan relevant recent top-up intents with bounded Base RPC failover                           | defer transient RPC outages; log fatal failures |
| every 30 minutes on GitHub      | non-billable live smoke check of `xguard-mainnet`                                            | open one monitor issue; auto-close on recovery  |
| each started Durable Object     | stale-submission alarm and durable outbox retry                                               | mark ambiguous; never retry settlement          |
| operator reconciliation command | ledger/ambiguity/recovery report                                                             | non-zero exit; payout considered suspended      |
| weekly / dependency event       | locked build, tests, audit, CodeQL/Dependabot review                                         | block release on high/critical finding          |

The production Worker, Durable Objects, D1 projection, one-minute scheduled maintenance, five-minute automatic top-up scan cadence, and GitHub live mainnet monitor are configured. The live monitor performs no payment: it checks public health/readiness/capabilities, provider and discovery surfaces, MCP/Glama exposure, reconciliation state, billing metadata privacy, and the Base mainnet contract. Repeated failures are deduplicated into one GitHub issue and a later successful run closes that issue automatically.

Automatic testnet deployment is disabled. The separate Base Sepolia Worker remains available only through its manual deployment workflow for explicit non-billable testing and is not part of production monitoring.

## Portable local commands

```bash
npm run ops:reconcile -- ./xguard.db
npm run ops:backup -- ./xguard.db ./backups
npm run ops:payout-check -- ./xguard.db
```

These commands operate on the legacy/local Node SQLite path; they are not the deployment mechanism for `xguard-mainnet`. `ops:reconcile` exits non-zero for a ledger imbalance or open ambiguity and also recovers stale/prepared local records. `ops:payout-check` reports a decision but neither prepares nor submits a transfer.

The production Cloudflare Worker uses Durable Object alarms for stale-start recovery and durable coordination, D1 for mainnet state, and scheduled Worker maintenance for facilitator health, finality, cleanup, reconciliation, and top-up discovery.

## Service objectives

Track gateway availability plus p50, p95, and p99 added latency; verification/settlement success; facilitator health; replay/duplicate prevention; ambiguity; usage events; gross revenue; downstream/infrastructure/off-ramp cost; contribution; reserve; and payout state. Targets are established only after a representative live baseline. XGuard makes no fabricated uptime or latency claim.

## Capacity and safe scaling

Alert at 70% of a free quota, investigate at 80%, and block growth-sensitive operations before hard exhaustion. Upgrade only for sustained saturation, objective latency/reliability breach, forecast quota exhaustion, or a required control unavailable on the free tier. Before any paid upgrade, verify:

```text
earned available funds - customer liabilities - unpaid costs - required reserve >= upgrade cost
```

An upgrade also requires an authorized business payment method. Otherwise the service remains on the best free architecture and the upgrade alone is an external blocker.

## Backup and restore

The legacy/local Node backup command uses SQLite's online backup API and immediately runs `PRAGMA integrity_check`. Restore is performed into a new path, integrity-checked, reconciled, and smoke-tested before changing local service configuration. Never overwrite the only database copy.

Production mainnet persistence is Cloudflare D1 and must be treated separately from the local SQLite backup path. Cloudflare's native recovery features do not replace the need for an independent encrypted production export and a recorded restore exercise before claiming an off-platform backup objective is satisfied.
