# Operations

Normal traffic is designed to require no owner processing. Financial ambiguity is the exception: automation quarantines it and waits for independent evidence rather than risking a second transfer.

| Cadence / trigger               | Implemented automatic action                                                     | Failure behavior                                |
| ------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------- |
| every request                   | structured request/latency/result metrics; no raw payment body                   | sanitized error and request ID                  |
| every 5 minutes on Worker       | facilitator capability/health probe, expired-ID cleanup, D1 ledger-balance check | degrade/open/quarantine route or reconciliation |
| every 30 minutes on GitHub      | non-billable live smoke check of the public testnet                              | open one monitor issue; auto-close on recovery  |
| each started Durable Object     | stale-submission alarm and durable outbox retry                                  | mark ambiguous; never retry settlement          |
| every minute on Node process    | refresh capabilities; expire prepared work; quarantine stale started work        | keep last safe state and log sanitized failure  |
| operator reconciliation command | ledger/ambiguity/recovery report                                                 | non-zero exit; payout considered suspended      |
| weekly / dependency event       | locked build, tests, audit, CodeQL/Dependabot review                             | block release on high/critical finding          |

The testnet Worker, Durable Objects, D1 projection, five-minute health cron, and GitHub-based live smoke monitor are configured. The smoke monitor performs no payment: it checks public health/readiness/capabilities, reconciliation state, malformed-input rejection, and the mainnet hard gate. Repeated failures are deduplicated into one GitHub issue and a later successful run closes that issue automatically.

Daily external treasury/provider reconciliation, encrypted off-platform backup rotation, off-platform alert delivery, and owner payout submission are not connected in the testnet release. Testnet has no billable money or owner payout.

## Portable commands

```bash
npm run ops:reconcile -- ./xguard.db
npm run ops:backup -- ./xguard.db ./backups
npm run ops:payout-check -- ./xguard.db
```

`ops:reconcile` exits non-zero for a ledger imbalance or open ambiguity and also recovers stale/prepared local records. `ops:payout-check` reports a decision but neither prepares nor submits a transfer. The Cloudflare Worker uses alarms for stale-start recovery and durable outbox projection, plus a cron trigger for facilitator health and D1 integrity checks.

## Service objectives

Track gateway availability plus p50, p95, and p99 added latency; verification/settlement success; facilitator health; replay/duplicate prevention; ambiguity; usage events; gross revenue; downstream/infrastructure/off-ramp cost; contribution; reserve; and payout state. Targets are established only after a representative live baseline. XGuard makes no fabricated uptime or latency claim.

## Capacity and safe scaling

Alert at 70% of a free quota, investigate at 80%, and block growth-sensitive operations before hard exhaustion. Upgrade only for sustained saturation, objective latency/reliability breach, forecast quota exhaustion, or a required control unavailable on the free tier. Before any paid upgrade, verify:

```text
earned available funds - customer liabilities - unpaid costs - required reserve >= upgrade cost
```

An upgrade also requires an authorized business payment method. Otherwise the service remains on the best free architecture and the upgrade alone is an external blocker.

## Backup and restore

The Node backup command uses SQLite's online backup API and immediately runs `PRAGMA integrity_check`. Restore is performed into a new path, integrity-checked, reconciled, and smoke-tested before atomically changing the service configuration. Never overwrite the only database copy. Cloudflare D1 Free currently provides seven-day Time Travel; production financial retention still requires an independent, encrypted export and a recorded restore exercise. No external backup destination is configured in this environment.
