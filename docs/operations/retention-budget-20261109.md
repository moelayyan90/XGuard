# Bound retention work inside the public analytics allocation

Provider incident tail [42655408380](https://github.com/moelayyan90/XGuard/actions/runs/42655408380) confirmed that /witness/verifier-key, /healthz and public fact reads fail with `Exceeded allowed rows written in Durable Objects free tier`. The witness 500 is correlated directly with that runtime exception, rather than inferred from discovery metadata.

The first recovery release fixed per-request analytics amplification. The old daily operational cleanup still used unbounded DELETE statements. A backlog could therefore spend a large part of the next daily allowance in one cleanup, even after incoming telemetry was bounded.

This follow-up splits the same 500-row per-shard/day component allocation into 250 for incoming analytics and 250 for optional retention. Combined allocation remains 16,000 across the fixed 32 shards, excluding separate scheduler/collector and provider metadata costs. Existing old-release counters are carried forward conservatively; no deployment or object restart resets the allocation. The SQLite cursor counters are application measurements, not an account-wide billing reservation.

Expired raw crawler rows are selected through the timestamp index in bounded pages. Old visitor rows use the leading primary-key day. Rate limits have no expiry index, so cleanup walks bounded primary-key pages with a durable cursor instead of scanning all live keys. Each batch reserves indexed-write and checkpoint headroom, persists actual measured cursor costs and stops at its component/day allocation. No new schema/index migration is introduced. No financial, settlement, replay, idempotency, source observation, receipt, audit or provider-report table is deleted.

Raw retention is eventual under an outage/backlog, rather than an unconditional 7-day promise; the privacy text now states that samples become eligible for bounded removal after 7 days and that storage outages can delay removal. Existing privacy limitations on raw IP collection remain unchanged. Financial audit retention is untouched.

## Local paired measurement

See [infra-budget-20261109.json](infra-budget-20261109.json). Against exact e96b831, 2,048 repeat verified-crawler requests still record all 2,048 while writes fall 10,242 → 195. For 3,000 expired operational rows and 10 repeated cold-store cleanup attempts, cleanup writes fall 3,000 → 240 (92%); the persistent operational counter ends at 492, with telemetry and cleanup each 246. The remaining expired samples are deliberate bounded backlog, not lost data or a claim of immediate full deletion. Immutable source observations and current fact values remain intact. Source revalidation costs are unchanged.

A separate regression test seeds a pre-split 499-row budget and proves repeated cleanup performs no SQL mutation and does not reset/overspend that record. All of these are isolated real workerd/SQLite or Node SQLite fixtures; no financial transaction or external-provider load is involved.

## Current deployment evidence

PR #599 and #600 are merged. Main CI [42654773467](https://github.com/moelayyan90/XGuard/actions/runs/42654773467) passed. Deployment [42655328613](https://github.com/moelayyan90/XGuard/actions/runs/42655328613) correctly stopped at the new capacity preflight: `storage_write_quota_exhausted`, reset `2026-11-10T00:00:00.000Z`, `upload_attempted:false`. The previous Worker 9deb055f-c803-47ee-acda-e76c89d454f6 remains active. A prior 5% canary was rolled back by full protocol checks. No verification gate was relaxed and no quota was bypassed.

A finite recovery follow-up is scheduled after reset, with hourly checks over a full daily cycle. It must verify CI, perform the existing gradual nonfinancial release, test all public/payment/witness interfaces without spending, collect actual account counters and report any remaining capacity gap. No measured production after-reduction or final recovery is claimed yet. Native settlement remains isolated, production-disabled and without a real signer or real settlement proof; Agent402 was not contacted.
