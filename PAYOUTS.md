# Payouts

## Current capability

Automatic payout is `NOT_SUPPORTED`.

The dormant safety policy is configurable as `PAYOUT_THRESHOLD_USD`, `MIN_RESERVE_USD`, and `OPERATING_RESERVE_PERCENT` (default `20`). These values cannot trigger a withdrawal while the verified DGrid withdrawal contract is unavailable.

[DGrid Marketplace](https://dgrid.ai/marketplace) advertises on-chain settlement and payouts, and the [official announcement](https://blog.dgrid.ai/posts/2026-07-23/) describes verified on-chain revenue. DGrid's public docs do not publish the asset, chain, withdrawal threshold, fee, destination API, custody rules, confirmation policy, or payout webhook. XGuard will not infer those details.

## Destination secret

The only payout destination input is the Cloudflare secret:

```text
XGUARD_PAYOUT_DESTINATION
```

It must never be committed, hard-coded, logged, written to D1, exposed in the public status, or copied into deployment output. The owner dashboard reports only `CONFIGURED` or `NOT CONFIGURED`. A payout row may contain a one-way destination fingerprint after an official payout transaction exists; it must not contain the destination itself.

## State transitions

Payout-related revenue can advance only with external evidence:

1. `PENDING` after a real successful inference.
2. `SETTLED` after a unique DGrid settlement reference.
3. `WITHDRAWABLE` after DGrid confirms withdrawal eligibility.
4. `WITHDRAWN` after a transaction or official withdrawal reference exists.
5. `RECEIVED_BY_OWNER` after owner receipt is verified.

Retries must use the same external reference and remain idempotent. No balance screen, estimate, or pending token count is a payout.

## Activation rule

Automatic payout can be enabled only after DGrid publishes or contractually supplies all of the following:

- authenticated destination configuration;
- supported asset and chain;
- withdrawal endpoint or event contract;
- idempotency and finality rules;
- fee and minimum-withdrawal rules;
- a safe way to verify owner receipt.

Until then, the runtime returns `NOT_SUPPORTED` rather than `OFF`, because there is no verified automation contract to switch on.
