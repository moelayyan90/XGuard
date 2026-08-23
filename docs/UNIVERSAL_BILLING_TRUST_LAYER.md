# XGuard Universal Billing & Trust Layer

## Primary product

XGuard's primary user-facing product is a **universal multi-merchant payment cart**.

A payer can collect multiple independent Payment Claims, review one combined checkout, approve once, and let XGuard execute or orchestrate the allocations to their intended recipients.

```text
collect claims -> reserve -> review once -> approve once -> pay everyone -> unified receipt
```

See `docs/UNIVERSAL_MULTI_MERCHANT_CHECKOUT.md` and `specs/batch-payment-intent.schema.json`.

## Universal payment event layer

Under the checkout, each supported rail adapter converts native provider activity into one XGuard payment event envelope so XGuard can normalize verification, truth, billing, reconciliation, and receipts.

The universal unit is a **payment event**, not a specific protocol request.

## Execution modes

### Atomic onchain batch

For stablecoins and compatible wallet/agent rails, one signed batch intent binds all recipients, amounts, fees, expiry, and the claims commitment. A compatible router or signature-transfer mechanism executes the transfers atomically when the rail supports it.

### Platform split

For regulated marketplace/payment platforms that support multi-seller or split settlement, XGuard supplies the allocation plan while the PSP performs the customer charge and distribution to its onboarded recipient accounts.

### Coordinated child payments

When unrelated rails cannot share one native transaction, XGuard may provide one approval UX that authorizes a bounded set of child payments. The receipt must clearly show that these are multiple underlying payment transactions, not misrepresent them as a single card/acquiring transaction.

## Payment Claim

Each merchant/service exposes an authenticated claim with:

- merchant/beneficiary;
- amount and currency/asset;
- destination rail;
- invoice/order/resource reference;
- expiry;
- provider evidence or merchant signature.

Merchants do not need an XGuard account when their platform already exposes or translates the claim for them.

## Settlement Truth and retry safety

Settlement Truth Standard remains the common result/evidence model. Retry safety remains a supporting invariant: ambiguous child payments must not be blindly duplicated.

These are safety primitives supporting the universal cart, not the primary product story.

## Billing

Pricing is configured per rail and can include:

- disclosed payer batch convenience fee;
- platform/rail usage fee;
- per-child settlement fee;
- volume tiers;
- share of an existing platform fee where contractually supported.

The buyer-approved merchant amounts and recipients must remain visible and bound to the authorization. XGuard must not silently divert funds.

## Necessary-layer thesis

The adoption loop is:

> **If a merchant wants to be payable inside the Pay-All experience, its platform exposes an XGuard-compatible Payment Claim. If a wallet wants one-click multi-service checkout, it implements XGuard Batch Payment Intents.**

This is the target network effect: XGuard becomes the common cart and batch authorization layer between payable claims and heterogeneous payment rails.

## Honest boundary

XGuard cannot turn arbitrary unrelated card merchants into one native card transaction without a licensed marketplace/merchant-of-record/payment platform that supports that model. Where this is unavailable, XGuard must either use multiple child transactions with one explicit user mandate or not support that combination.
