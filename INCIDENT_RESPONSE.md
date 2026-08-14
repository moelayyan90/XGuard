# Incident response

## Priorities

1. prevent additional financial harm;
2. preserve immutable evidence;
3. maintain safe verification/diagnostics where possible;
4. reconcile before resuming settlement or payout;
5. communicate verified facts without exposing payloads or secrets.

| Severity | Examples                                                                        | Immediate automated response                                         |
| -------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| SEV-1    | possible duplicate settlement, treasury mismatch, key compromise, forged payout | disable settlement/payout, quarantine route, preserve logs and state |
| SEV-2    | ambiguous settlement, facilitator incident, reconciliation drift                | stop that payment/route, open case, retain hold, alert               |
| SEV-3    | degraded latency, quota pressure, projection delay                              | circuit-break/fail over verification, retry idempotent projection    |
| SEV-4    | documentation or non-critical diagnostic defect                                 | record, test fix, normal release                                     |

## Financial inconsistency procedure

1. Persist the last known transition and request/evidence digests.
2. Never replay a settlement whose outbound submission may have started.
3. Quarantine the payment and, if needed, the facilitator.
4. Suspend all owner payouts when treasury, ledger, chain, provider, or prior payout state is inconsistent.
5. Query facilitator status and independent chain evidence by the original authorization and transaction reference.
6. Resolve with an attributable evidence reference; apply only idempotent finalization or compensating entries.
7. Run ledger, liability, treasury, usage, and payout reconciliation before resuming.

## Credential incident

Disable the affected credential at its provider, issue a replacement through encrypted secret storage, deploy without printing either value, inspect access/audit logs, and invalidate replayable webhooks/API keys. A payout destination change requires re-verification and a payout freeze; it is never accepted from an unauthenticated request.

## Recovery

Code may roll back to a known-good build. Financial database state is never rolled back over newer events. Restore into an isolated database, compare append-only events and provider/chain evidence, then promote only a reconciled result. Publish incident status only from confirmed facts and never reveal sensitive topology or personal financial data.
