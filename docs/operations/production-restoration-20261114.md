# Production restoration — 2026-11-14

## Recovery point and evidence

Before any production mutation, preserved the complete current source/configuration
at [`recovery/snapshot-20261114-e1528aa`](https://github.com/moelayyan90/XGuard/tree/recovery/snapshot-20261114-e1528aa).

- Git ref: `e1528aa1bc5ac889ca4e42994f38536b30078671`.
- Active Worker: `xguard-mainnet`, version `a1974689-4772-4b19-b55a-d06c0aafeba7`, 100%.
- Last successful deployment: [43177049071](https://github.com/moelayyan90/XGuard/actions/runs/43177049071), 2026-11-12 07:43 UTC.
- Non-secret deployment configuration: `apps/relay/wrangler.jsonc` at that ref;
  SHA-256 `162d0d6a6e90304e77770c4d82904d4dcf444450d119f63a9ab621de8b993091`.
- Dashboard confirmed apex, `www`, and `api` custom domains on the same Worker;
  workers.dev and preview URLs disabled. No routing/domain change is required.
- WAF dashboard: 0 custom rules, 0 rate-limiting rules, no configured managed
  rules, default response protection. Under Attack and Development modes off.
- Worker observability remains enabled with the existing 0.2 log/0.1 trace sampling.
- Durable Object classes, placement, bindings, migrations, financial state versions,
  signer configuration, balances and all stored data are preserved. This snapshot
  is source/configuration plus a version reference, not a database export.

The last passing deployment establishes a working contract, not proof of a fully
healthy quota-safe day. No earlier version is proven to provide that guarantee.
Returning to old code would undo C2SP witness identity protections and restore
known unbounded collection writes. A compatible corrective release is used.
The normal guarded deployment snapshots the active version again and can roll
back compatible code if live verification fails.

## Confirmed causes and limits

1. **Real repeated write exhaustion.** Provider audit
   [43530506237](https://github.com/moelayyan90/XGuard/actions/runs/43530506237)
   recorded 101,688 rows written on 2026-11-13 against the free 100,000 allowance.
   LiveShard wrote 96,000 and LiveControl 5,628; witnessing wrote 1. The separate
   3,306,749 read count did not reach the 5,000,000 read allowance. Existing source
   collection continued writing after optional analytics had already been bounded.
   The next UTC-day audit recorded 38,283 writes at 06:24 UTC. See
   [provider-before.json](../evidence/restoration-20261114/provider-before.json).
2. **Application traffic undercount.** `f2d63e1` and `ba7a28e` (2026-11-09) buffer
   optional analytics and omit events after a shard allocation is reached. These
   counters cannot establish a collapse in actual traffic. Budget omissions and
   eviction losses cannot be reconstructed retrospectively from the application.
3. **No evidence of a complete current traffic collapse.** Before this release,
   the dashboard showed about 31.77k Worker invocations/24h and 144.84k/7d, up
   51.9% and 72.0% respectively. Zone HTTP analytics showed approximately 32.16k
   requests/24h: 23.52k 2xx, 297 3xx, 2.84k 4xx and 5.51k 5xx (17.13%). The
   5xx table identified 503 as the dominant server failure. These views have
   different refresh/sampling windows. Worker exceptions alone (44) do not count
   handled HTTP 503 responses. Zone unique-visitor estimates include bots and are
   not proof of human demand, customers or sales.
4. **Missing readiness compatibility.** Before probes returned `/readyz` 404 and
   `/a2a/health` 410 on both origins. Core MCP, A2A discovery, public fact/history
   reads and the witness verifier key were reachable at probe time. Unsupported
   `/witness/status` was a diagnostic mistake: the actual contract uses an origin
   hash in `/witness/<sha256-origin>/status`; its 404 is not a production defect.
5. `robots.txt` training-bot exclusions date to `3647d03` (2026-10-04), not the
   recent incident. Search/assistant access, canonical fact links, source sitemaps
   and published discovery remain public. No security protections are disabled.

Available logs support quota exhaustion and recording changes; they do not prove
that one recent commit caused every change in traffic or identify all callers.
Observed automated traffic includes MCP and package-history/fact/change retrieval;
user-agent/browser labels alone do not establish human or verified-agent identity.

## Corrective behavior

- Persist an independent 1,600-row source mutation allocation per fixed shard/day,
  51,200 across 32 shards, conservatively counting indexes, triggers and budget
  checkpoints. A first use mid-day receives the remaining day's fraction;
  first-ever enforcement withholds another 25% for pre-release writes. Subsequent
  UTC days use the normal allocation. The pre-release 10:03 UTC audit already
  measured 58,310 writes, so deployment cannot assume a fresh daily allowance.
- Reserve before a synchronous collection mutation. Persist deferral across
  restart and schedule the next eligible UTC day instead of retrying writes in
  a tight loop. Failed transactions keep a conservative reservation.
- Apply this to admission, changed/unchanged source observations, failure and
  fetch records and new discovery candidates. Preserve the existing one-write
  domain backoff and ten-minute minimum alarm spacing. Keep existing bounded
  analytics/retention separate. Scheduling metadata and LiveControl operations
  still consume provider resources; this is not an account-wide quota guarantee.
- Preserve existing observations and public reads during collection deferral.
  Deferred verification ages normally to STALE; freshness is never fabricated.
  A source mutation larger than the available allocation is deferred, never
  truncated or partially published. Capacity remains a real free-plan constraint.
- Restore `/readyz` and `/a2a/health` as uncached GET/HEAD aliases of the existing
  storage/heartbeat health check. Keep protected API/payment boundaries intact.
- Label private application traffic counters as partial lower bounds and link
  their interpretation to provider HTTP analytics instead of treating them as
  unique visitors or complete traffic.

## Validation and comparable windows

[Before probes](../evidence/restoration-20261114/production-before.json) were
explicitly synthetic unsigned diagnostics, never paid execution or traffic
generation. `/verify` and witness ingest reject empty unsigned bodies as expected.
Core MCP initialize/tools-list requests returned 200. Diagnostic probes are not
evidence of demand or payment success.

The pre-release matched-window reference is Cloudflare zone HTTP analytics for
2026-11-14 **12:30–12:45 Asia/Amman** (09:30–09:45 UTC): **352 total**, **332 2xx**,
**0 3xx**, **20 4xx**, **0 5xx**. This interval was already serving traffic after
the provider's daily reset. A post-release interval must be collected before
claiming any before/after change; neither a deployment nor a short successful
window proves recovery to 9,000 human visits/day or no future exhaustion.

Local evidence: 97 unit tests, 7 infrastructure safety tests, 11 witness/canary
contract tests, strict types and dry-run build passed. Paired real workerd kept
24 public compatibility cases, 2,048 buffered telemetry events and immutable
history behavior. The new source-budget fixture admitted 83 revalidations,
measured 1,466 SQL writes under a conservative 1,552-row charge, then performed
zero writes across 20 restart/deferral attempts while keeping the fact readable.
See [source-budget.json](../evidence/restoration-20261114/source-budget.json).

Production deployment, post-release probes, equal-window analytics and provider
usage follow-up must be recorded after they actually occur.
