# Operations

## Scheduled control loop

Cloudflare Cron runs at minute 0 every hour.

- Every run synchronizes safe runtime configuration and checks each approved upstream with `GET /models`.
- At UTC hours divisible by six, the optimizer ranks routes and records an `optimization_runs` audit row.
- Profit buckets are refreshed from D1 truth states.

The optimizer can change only XGuard's internal primary/failover status. It cannot claim or change DGrid routing share or external marketplace price because DGrid has not published those APIs.

## Health states

- `UNCONFIGURED`: missing legal activation gate.
- `HEALTHY`: current 2xx model-list response.
- `DEGRADED`: current 429 health response.
- `UNHEALTHY`: timeout, transport failure, or other non-2xx response.

Health older than two hours is stale and cannot activate a route.

## Owner control plane

Use a bearer `XGUARD_ADMIN_TOKEN` with:

- `GET /owner` — private HTML dashboard;
- `GET /v1/admin/metrics` — private machine-readable accounting;
- `POST /v1/admin/maintenance` — run one health/optimization cycle.

Do not put the bearer token in a URL, browser history, issue, log, or chat message.

## Incident response

1. Set the affected upstream `RESALE_APPROVED=false` or remove its API key.
2. Deploy; runtime sync marks its provider and models disabled.
3. Inspect `provider_health`, `upstream_requests`, `network_requests`, `costs`, and `revenue` by request ID.
4. Do not convert `PENDING` revenue to `SETTLED` during an incident without external settlement evidence.
5. Rotate the affected upstream or network secret.
6. Re-enable only after health, legal authority, pricing, and the profit guard pass.

## Financial reconciliation

Daily reports use UTC. Real requests are successful upstream executions. Cost is recorded on successful execution even when network revenue is still pending. Net profit uses only `SETTLED` revenue.

DGrid settlement import remains disabled until its provider-channel supplies an authenticated settlement contract. Operators must not write optimistic rows directly to D1. Once official fields exist, implement an idempotent importer keyed by DGrid's external settlement ID and require an evidence reference.

## Target handling

`$350/day` is an operational target. It is `ACHIEVED` only when UTC-day settled revenue minus real cost is at least 350,000,000 micro-USD. There is no traffic generation, self-calling, fake demand, or synthetic revenue mechanism.
