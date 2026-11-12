# GBLIN → XGuard witness stability and canary readiness

## Live baseline, 2026-11-12

[Captured GET-only evidence](../evidence/c2sp-stability/production-before.json)
verifies the actual public endpoints, not a reconstruction from issue comments.

| Observation | Verified result |
| --- | --- |
| GBLIN checkpoint | HTTP 200, size 214 |
| XGuard monitor | HTTP 200, size 214, matching root |
| Root | `j4ypIH75PDYatHM1nLOBTk6z9Ke9YWEBp024O+oyCVY=` |
| GBLIN's XGuard push record | size 214, `2026-11-12T01:20:12.591Z`, `last_error: null` |
| XGuard signature in GBLIN's checkpoint | independently verified with Node/OpenSSL; time `2026-11-12T01:20:12Z` |
| XGuard signature in its monitor | independently verified; time `2026-11-12T06:30:52Z` |
| Log-only growth | valid consistency proofs 212→213 and 213→214 |
| Historical XGuard delivery of 213 | **not proven** by available live evidence |

The later monitor time came from our post-deployment runner
[43168644707](https://github.com/moelayyan90/XGuard/actions/runs/43168644707),
which resubmitted the same size. Earlier runner
[43165897389](https://github.com/moelayyan90/XGuard/actions/runs/43165897389)
also checked 214. Neither is another log-size growth event. The previous
monitor held only the last note; GBLIN's outgoing push record also overwrites
its previous value. A live proof of log growth through 213 cannot prove that
XGuard actually received and signed 213. No such historical delivery is invented.

Pinned production witness key:

```
xguardgate.com/witness+4cbdcb41+BGR+T6u+czYHsxrFwXaOkfMFlzoAFNeHmYmSbwBlqY2Q
```

Pinned log origin/key:

```
gblin.digital/receipts-log
gblin.digital/receipts-log+00c6e18c+AY8/YnCHXTnsECT2EGv0M5RTqlVvFobctLv3WSihYkoG
```

## Implemented hardening

- Preserve the namespace, class, object name, key record and head keys. In a
  deployed Worker, require the exact existing public identity. Missing or
  damaged key/state fails closed instead of generating a replacement.
- Authenticate the incoming pinned-log signature and validate the declared
  old size/proof before accepting a request. Identical signed bodies reuse
  the existing verified cosignature and preserve its timestamp without a write.
- Bound ingress and pending updates to 16. Return 429 with Retry-After under
  backpressure. A failed request cannot poison the serialized queue.
- Keep at most 32 successful growth events, capped at 16 KiB, in the same
  atomic head record. Cap the entire record at 96 KiB before a storage write.
  Record real acceptance time, old/new size, root, signed body and cosignature.
  Duplicate probes do not count. Existing heads have no invented history.
- Add read-only status, Worker version headers and hourly GET-only auditing.
  Current health and multiple historical deliveries are separate assertions.
  The audit reports `several_witness_growth_events_proven` explicitly.
- Invalid/untrusted traffic does not create persistent per-error writes.
  GBLIN's public `last_error` and failed audit artifacts supply available error
  evidence; the status endpoint does not claim to reconstruct every past failure.

No financial state, binding, namespace, signer identity or settlement path is
changed. Cloudflare account-wide free limits can still stop storage. The
[provider audit](https://github.com/moelayyan90/XGuard/actions/runs/43165277511)
measured 37,503 writes and 1,088,523 reads at 06:01 UTC; most writes belonged
to LiveShard, not witnessing. That is a point-in-time count, not reserved
capacity or a promise of uninterrupted future operation. Paid capacity is not
enabled. Restore the original Durable Object state through the provider's
recovery mechanism if lost; never rotate the witness key automatically.

## Reproducible checks

```
node --test apps/relay/test/c2sp-witness.test.mjs apps/relay/test/c2sp-interop.test.mjs
node apps/relay/test/c2sp-workerd.mjs
node --test scripts/c2sp-stability-contract-test.mjs scripts/gblin-canary-compare-test.mjs
node scripts/c2sp-stability-audit.mjs
```

The runtime retains all 40 GBLIN Go-reference cases and five competing growth
requests. Extra checks cover zero-write duplicate replay, bounded ingress,
storage failure/recovery, cached-signature corruption, missing/mismatched
production keys, missing head, SQLite restart and persistent growth history.
Offline audit cases use captured public signed material, without any financial
key or real transaction. The empty history case must never count log-only
consistency proofs as witness deliveries.

Local release validation passed: 97 application unit tests, 9 audit/canary
contract tests, the 40 Go-reference cases plus 5 competing updates in real
workerd, full runtime regressions, strict type checks and a dry-run build.
The real workerd production class also rejects an empty key namespace; local
positive fixtures use explicitly isolated ephemeral keys, never the real key.

The existing compatible deployment uses a 0% candidate GET-only check, then
5% and 100% promotion with public monitoring. The key pin is checked before
promotion. The scheduled C2SP workflow uploads public evidence for 30 days.
An audit may fail during real upstream lag rather than silently submit a repair.

## Canary boundary

No canary route or exact request fixture has been supplied in the checked
issue thread. `scripts/gblin-canary-compare.mjs` refuses to run without one.
There is no default substitute route. Its fake test URLs are intercepted only
inside offline tests and are never sent to production.

After obtaining and reviewing the exact fixture from @gblinproject, run:

```
node scripts/gblin-canary-compare.mjs /path/to/reviewed-gblin-fixture.json
```

The fixture must supply `provided_by`, `source_comment`, `non_promised: true`,
`bazaar_indexed: false`, `hash_pinned: false`, `unpaid_request: true`, exact
`direct_url`/`through_xguard_url`, unsigned `request` method/headers/body,
`expected_402_body_base64`, `expected_headers` and exact
`direct_facilitator`/`xguard_facilitator` URLs. Operator-recorded flags are
assertions to review, not independent proof that GBLIN approved a route.
Current challenge hosts are limited to GBLIN and XGuard. A direct facilitator
outside those hosts needs explicit review before adding it; none is guessed.

The comparison preserves exact challenge bytes and critical headers, records
three anonymous latency samples for each path, captures `/supported`, and
tests only **empty unsigned** `/verify` and `/settle` requests. Credentials and
payment authority are rejected. Error-status differences remain visible;
successful paid verification/settlement is not established. A matching unpaid
challenge alone does not prove internal facilitator traversal. No recipient,
asset or price is altered. Protected production routes and reverse ProofRail
C2SP publication remain outside this release.

The next issue update should report the verified 214 state and absence of a
current GBLIN error, qualify the missing historical delivery evidence, and ask:
"Please send the non-promised, non-Bazaar-indexed canary route and the exact request fixture."
