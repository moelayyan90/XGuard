# Security policy

## Supported status

The canonical production runtime is the live `xguard-mainnet` Cloudflare Worker on Base mainnet. The repository's npm/CLI artifacts remain alpha/prerelease software; that package versioning is separate from the production Worker deployment status.

The checked-in mainnet entrypoint is `apps/worker/src/universal-mainnet.ts`. The separate Base Sepolia Worker and the legacy/local Node gateway are test paths. In particular, `apps/gateway` remains compile-time blocked from mainnet and is not the source of truth for `xguard-mainnet`.

Security claims are limited to implemented controls and executed tests. XGuard is not described as unhackable, risk-free, independently certified, or externally audited unless such evidence is obtained separately.

## Private reporting

Do not open a public issue containing vulnerability details, payment payloads, API keys, wallet secrets, personal data, or financial destination data. Use GitHub's private vulnerability reporting/security channel when available for this repository. If a private channel is unavailable, contact the maintainer without including secrets in a public issue.

## Implemented controls

- Strict JSON/request parsing with bounded body size and schema validation on protected mainnet paths.
- Exact x402 v2 Base mainnet network, asset, recipient, amount, expiry, mechanism, and accepted-requirements binding.
- Merchant bearer authentication before protected x402 execution can become a chargeable accepted attempt.
- Canonical `logicalPaymentKey` identity for the fixed x402 attempt fee so retries and verify → settle do not create a second fixed fee.
- SQLite-backed Durable Object serialization for per-authorization settlement ownership and concurrency control.
- Outbound state persisted before network settlement; uncertain post-submit outcomes become ambiguous and are not blindly resubmitted.
- Independent Base USDC finality verification for **settlement truth** and recovery. Finality does not retroactively determine whether the earlier canonical accepted-attempt fee was earned.
- D1-backed merchant balance, settlement truth, reconciliation, usage and discovery projections with idempotent keys/constraints.
- HTTPS-only configured production routes, bounded upstream responses, redirect rejection where financial routing requires it, and fail-closed behavior when required protection is unavailable.
- Per-client/public rate limits plus dedicated upstream quota protection on the current mainnet route.
- Production API keys are stored as hashes rather than plaintext credentials.
- Structured logs and sanitized error responses; raw payment bodies and secret values are not intentionally emitted as telemetry.
- Public discovery metadata is treated as untrusted input and kept separate from settlement correctness.
- Secret scanning, dependency audit, release verification, CodeQL, Dependabot, unit/concurrency/worker tests, and post-deploy live mainnet smoke checks.
- The legacy/local Node gateway remains compile-time blocked from mainnet; environment variables cannot promote that code path into the production Worker.

## Billing security invariant

The canonical public x402 service fee is **$0.03 / 30,000 micro-USD once per accepted authenticated economic attempt**. Acceptance requires authentication, supported-request parsing, `logicalPaymentKey` derivation and successful prepaid-balance reservation. The fee is earned before downstream execution and is non-refundable merely because downstream execution later fails.

This billing rule must not weaken settlement safety: an uncertain or failed downstream result is still handled through settlement truth/reconciliation, and XGuard must never create a second onchain submission to “make up” for a paid attempt.

## Secret rules

Never commit seed phrases, private keys, production API keys, webhook secrets, provider credentials, personal payout destinations, or banking data. Store only secret names/references in code and documentation where a secret is required. Deployment credentials must use the platform encrypted secret store; local secrets belong in untracked `.env` or `.dev.vars` files.

Public blockchain addresses, including the configured mainnet treasury address, are identifiers rather than private credentials and must never be confused with the private keys that control them.

The repository scanner intentionally prints only the file and finding class, never the matching secret value.

## Mainnet security status

The production Worker is protected by repository CI, CodeQL, adversarial/replay/concurrency tests, Cloudflare/D1/Durable Object controls, independent finality checks, and live mainnet smoke monitoring. Those are first-party controls and operational evidence, not an independent external security attestation.

Any future claim of independent certification, completed third-party audit, regulatory approval, provider-contract completion, or guaranteed security requires separate evidence outside this repository. External limitations are tracked in [DEPLOYMENT.md](DEPLOYMENT.md) and [docs/EXTERNAL_BLOCKERS.md](docs/EXTERNAL_BLOCKERS.md).
