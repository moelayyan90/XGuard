# Security policy

## Supported status

`0.1.0-alpha.0` is testnet-only and not a mainnet production release. Security claims are limited to controls implemented and tests executed; XGuard is not described as unhackable or risk-free.

## Private reporting

Do not open a public issue containing vulnerability details, payment payloads, API keys, wallet secrets, personal data, or financial destination data. Use GitHub private vulnerability reporting after the repository is published. Until then, no public reporting channel exists; publication is recorded as an external blocker.

## Implemented controls

- Strict JSON parser: 64 KiB default, depth/key limits, duplicate-key rejection, prototype-key rejection.
- Official schema parsing and exact top-level envelope validation.
- Integer atomic token amounts and `bigint` micro-USD throughout the billable Node ledger. The edge Worker uses bounded safe integers only on its hard-coded, zero-fee testnet projection and cannot be enabled for mainnet.
- Network, asset, recipient, amount, expiry, mechanism, and accepted-requirements binding.
- Permanent replay identity, official Payment Identifier conflict handling, transactional uniqueness, concurrency serialization.
- Outbound state persisted before network settlement; unknown post-submit outcome is ambiguous and never auto-retried.
- Bounded/streamed request and facilitator-response bodies, HTTPS-only configured routes, no redirects, public-only Node DNS, malformed-response quarantine.
- Per-client and global edge rate limits, per-client concurrency leases, and a bounded Node limiter.
- Typed finality/failure/payout evidence at financial state transitions; mainnet remains compile-time disabled because no production chain adapter or payout connector ships.
- SSRF-safe public checker: HTTPS/443 only, public DNS only, DNS pinning, no redirects, bounded response.
- HMAC API-key hashes with required production pepper, constant-time admin-token comparison, no secret values in logs.
- Structured logs, safe error responses, no raw payment payload telemetry.
- Database constraints, double-entry balance verification, idempotent usage and payout keys.
- Secret scan, dependency audit, CodeQL workflow, Dependabot, non-root/read-only Docker runtime.

## Secret rules

Never commit seed phrases, private keys, production API keys, webhook secrets, provider credentials, personal payout destinations, or banking data. Store only secret names/references in code and documentation. Deployment secrets must use the platform encrypted secret store; local secrets belong in untracked `.env` or `.dev.vars` files.

The repository scanner intentionally prints only the file and finding class, never the matching value.

## Mainnet security gate

Mainnet requires an external security review, current dependency review, real chain tests, a production independent-finality adapter, multi-instance database validation, webhook signature/replay tests for the selected billing/off-ramp providers, restore exercise, alert delivery, and closure of every critical/high finding. Both gateway release artifacts keep the code gate false until that evidence is recorded.
