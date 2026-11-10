# Infrastructure recovery — 2026-11-09

## Confirmed incident and baseline

Cloudflare's account alert says the free Durable Objects **100,000 rows_written/day** allowance was exceeded at 2026-11-09 12:14 UTC. Reset: 2026-11-10 00:00 UTC. This is separate from earlier read-allowance incidents. Nothing in this release increases the plan, creates paid resources, bypasses account limits, changes financial state formats or signs/transfers funds.

Read-only provider analytics at 15:46 UTC returned these UTC-day counters:

| Namespace | Rows read | Rows written | DO invocations |
| --- | ---: | ---: | ---: |
| LiveShard | 3,430,210 | 98,817 | 26,760 |
| LiveControl | 104,064 | 4,038 | 8,400 |
| PaidGatewayState | 206 | 172 | 279 |
| C2SPWitness | 69 | 3 | 120 |
| ProofAuthority | 13 | 0 | 92 |

These are Cloudflare analytics counters, not an invoice or an exact attribution of every HTTP request. Aggregate metrics can lag enforcement. LiveShard is the dominant writer. Its code persisted raw crawler rows and indexed aggregate updates for every classified request, including public cache hits. Collectors also update current validation timestamps, immutable source evidence and source scheduling state; these remain intact.

Provider Worker settings and namespace inventory were readable. Account subscriptions/billing returned HTTP 403 with the existing token. Account plan information is grounded in the provider's free-tier limit alert; a full billing audit remains blocked by that capability.

Before deployment, observed public probes included /healthz 503, /supported 200 (v2 exact Base, empty local signers), /.well-known/x402 200 and /witness 500. /readyz is not an existing live readiness endpoint (404); the existing /healthz contract is preserved.

## Recovery changes

* Coalesce simultaneous anonymous, query-free public GET cache misses by representation and Worker version. Existing TTL, ETag, Vary, expiry and Cache-Control logic remains authoritative. Authorization, cookies, health, owner, corrections and financial endpoints are excluded. No stale financial/security result cache is introduced.
* Batch optional public analytics into groups of at most 64 events, flushing on subsequent traffic after 60 seconds, scheduler ticks, alarms and owner metric reads. Preserve aggregate counts for buffered events; retain representative raw crawler samples. Pending analytics can be lost on eviction and optional events can be omitted at the analytics allocation. Counters are explicitly not financial accounting.
* Bound public analytics and optional retention together to 500 measured SQL cursor writes per fixed shard/day (16,000 across 32 shards), split into 250 for incoming metrics and 250 for bounded cleanup, with a conservative pre-admission reserve and local threshold logs at 50/75/90%. Preserve public access when this allocation is reached. Financial state, paid journals and replay records use separate paths.
* Persist the paid rate-limit rejection marker once and make admission transactional; repeated rejected attempts create no more writes. Do not delete absent previous buckets on every request.
* Retain every existing paid journey event, while scheduling the same journal retention alarm once rather than per event.
* Reject unknown witness paths before touching its Durable Object; convert provider transport failures into controlled 503 responses. Existing cryptographic validation and witness state are unchanged.
* Add a read-only provider audit every 30 minutes. Introspect actual analytics fields, collect account and namespace usage and emit 50/75/90% annotations. At 90%, fail the audit for existing GitHub Actions failure notifications. This does not send partner email, raise spending or automatically alter access policy. If analytics is unavailable, record that explicitly rather than assuming zero usage.

## Measured local evidence

See [infra-budget-20261109.json](infra-budget-20261109.json). Paired real workerd SQLite used the exact e96b831 base and identical fixtures. For 2,048 repeated verified-crawler requests, SQL writes fell **10,242 → 195 (98.096%)**, with all 2,048 aggregate requests retained and raw samples falling 2,048 → 32. A high-cardinality fixture stayed within the 500-row analytics allocation. For 100 unchanged source revalidations, both versions wrote 1,100 rows and returned the same fact. Thus **98.096% is an analytics fixture reduction, not a measured account-wide production reduction**.

Concurrent admission, restart persistence, complete financial journaling, public-read coalescing, witness error boundaries, existing workerd collection, C2SP interop, MCP, A2A, payment recovery and exact-base compatibility are required checks before promotion.

## Deployment and rollback

Use the existing compatible code-only 5% canary, candidate version override probes, 100% promotion and automatic rollback on service regression. Durable Object names, placement, bindings, migrations, state reader/writer versions, settlement contracts and signer configuration do not change. Provider-enforced exhausted allowances cannot be reset by deploying code. A controlled quota error after deployment is not a recovery claim; verify again after the UTC reset and collect comparable production windows.

Success still requires measured production reduction over comparable workloads and headroom for expected financial and public traffic. Local fixture results alone cannot establish that. Historical raw records are now removed in bounded, budgeted pages; no large migration or immediate mass deletion is introduced. See retention-budget-20261109.md for the follow-up and actual diagnostic evidence.

## Agent402

The full thread and latest 2026-11-09 message were read. Agent402 confirmed version and identity fixes, and declined because XGuard publishes no local signers and relays settlement through facilitators they already use. Their remaining condition is a real XGuard-controlled settlement signer on an accepted network, with demonstrated settlement capability. No partner message should be sent based on these infrastructure fixes or local native-engine tests. New production signing, gas funding and any real transfer require explicit owner approval.

## Provider reset follow-up — 2026-11-10

The documented 00:00 UTC reset did not restore writable production capacity immediately. Bounded probes at 00:03:27, 00:09:11 and 00:12:54 UTC still returned `storage_write_quota_exhausted` from the active `git-e96b831405ad` revision, with the response now advertising the next reset at 2026-11-11 00:00 UTC. `/witness/verifier-key` remained an Error 1101 consequence of the same storage-write exception. The deployment for current tested `main` was not retried because its mandatory capacity preflight would correctly stop before upload.

Read-only provider analytics at 00:04:43 UTC reported **0 rows read and 0 rows written** for the new UTC day, alongside 20 LiveShard, 3 LiveControl, 1 PaidGatewayState and 1 C2SPWitness invocations. This conflicts with the enforcement response and may reflect analytics or provider-reset lag. It is not evidence that the new day crossed 50%, 75% or 90%, and it is not a production savings measurement. The read-only audit rerun is [42649723667, attempt 2](https://github.com/moelayyan90/XGuard/actions/runs/42649723667/attempts/2); the exact observations are recorded in [provider-reset-check-20261110.json](provider-reset-check-20261110.json).

The old deployed code performs unbounded daily deletes of expired crawler requests, crawler visitors and rate-limit rows on each shard's first alarm. That path is consistent with LiveShard being the dominant writer and with the paired 3,000-to-240 cleanup fixture, but the provider counters above do not prove that those deletes executed after this reset. PR #602 replaces the unbounded deletes with persistent cursors and a shared 250-write cleanup budget per shard/day; that repair remains tested but not production-proven until a guarded canary can run and a complete comparable production day is measured.

Writable storage recovered by 00:15:50 UTC. The scheduled collector completed at 00:21:16 UTC and `/healthz` returned 200 with `storage: reachable` and `collector: scheduled`. Provider analytics through 00:15:33 UTC reported 113 rows read and **7 rows written (0.007% of the daily write allowance)**, all seven writes attributed to LiveShard. No 50%, 75% or 90% new-day threshold had been crossed at that observation.

The unchanged tested main SHA `f7ebedea01fdf6060b5da72c883b24f34845182a` then passed the mandatory capacity check, baseline verification, 0% candidate check, 5% canary, 90-second observation, 100% promotion and all deployment smoke steps in [run 42702669137, attempt 3](https://github.com/moelayyan90/XGuard/actions/runs/42702669137/attempts/3). Active production became Worker `aa9249c8-c4c1-44c5-af8e-c97ab89b44fc`, tag `git-f7ebedea01fd`. Health, public facts, x402 discovery, invalid verify/settle rejection, MCP, A2A and unpaid 402 boundaries passed with zero real transfers. `/supported` still publishes `signers: {}`. The financial-authority discovery endpoints publish `sandbox_operator_enrollment`, `sandbox_charge: 0`, `live_billing: not_activated` and no custody or spending key.

The first post-deploy C2SP runner verified the stable production verifier key, witness metadata, pinned GBLIN checkpoint signature and malformed-request boundaries, then failed before submission because GBLIN's consistency endpoint now returns JSON rather than newline Base64. PR #605 added strict dual-contract parsing with pinned origin, sizes, roots, proof bounds and canonical hashes; it merged as `b22cfc6e93b7d7b7838d3e9ef6fcbf3a042747a7` after CI and CodeQL passed. Main CI [42729127110](https://github.com/moelayyan90/XGuard/actions/runs/42729127110), deployment [42729527866](https://github.com/moelayyan90/XGuard/actions/runs/42729527866) and C2SP production verification [42729666034](https://github.com/moelayyan90/XGuard/actions/runs/42729666034) then passed. The witness verified consistency from size 208 to 210, returned a real XGuard cosignature and re-read the monitored checkpoint; zero payments were submitted. Active production is Worker `7fe3013e-5432-43b0-91ba-e7c9697c0b7f`, tag `git-b22cfc6e93b7`. A complete comparable 24-hour production window is still required before claiming the account-wide reduction target.

Monitoring continuity is currently impaired independently of production health. The audit schedule (`13,43 * * * *`) last created run [42726890619](https://github.com/moelayyan90/XGuard/actions/runs/42726890619) at 00:15:22 UTC; no runs were created for the expected 00:43, 01:13, 01:43 or 02:13 UTC windows. The hourly live monitor also last ran at 2026-11-09 22:31 UTC, leaving the expected 00:23, 01:23 and 02:23 UTC windows absent. At 02:33:51 UTC production `/healthz` was still 200 on Worker `7fe3013e-5432-43b0-91ba-e7c9697c0b7f`, tag `git-b22cfc6e93b7`, with storage reachable and the collector scheduled. The missing GitHub schedules therefore block a continuous provider-usage series; they do not establish a service regression or a quota-threshold crossing. A manual read-only dispatch could not be started from the available unauthenticated browser/CLI session, and no deployment or provider mutation was attempted.
