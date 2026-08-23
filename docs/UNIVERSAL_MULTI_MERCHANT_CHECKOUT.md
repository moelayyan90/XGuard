# XGuard Universal Multi-Merchant Checkout

## Core idea

XGuard becomes a **universal payment cart**: a payer can collect multiple independent payment claims, review one combined total, approve once, and have XGuard execute or orchestrate the individual allocations to their intended recipients.

User-facing invariant:

> **Add payments -> Review once -> Approve once -> XGuard pays everyone.**

The product is not limited to splitting one marketplace order. The long-term goal is to aggregate payable claims from multiple participating merchants, services, agents, invoices, or rails into one XGuard Batch Payment Intent.

## Why this is different

Existing marketplace products can split one platform payment among accounts that already belong to that platform. XGuard's target abstraction is one level above the provider: normalize multiple payable claims into one portable batch intent, then choose the safest settlement mechanism available for each rail.

XGuard MUST NOT claim that unrelated card acquirers can be merged into one native card transaction unless a licensed platform / merchant-of-record / marketplace rail actually supports that settlement model.

## Payment Claim

Each participating seller/service produces a signed or authenticated Payment Claim containing at minimum:

- `claimId`
- merchant / beneficiary identity
- amount
- currency / asset
- destination rail and recipient
- invoice / order / resource reference
- expiry
- refund / cancellation policy reference
- optional provider payment metadata
- cryptographic signature or authenticated provider evidence

A claim is a request for payment, not custody of funds.

## XGuard Cart

The payer can add multiple claims to an XGuard cart:

```text
Coffee shop       4.20 JOD
SaaS API           0.80 USDC
Delivery fee       1.50 JOD
Digital service    0.25 USDC
XGuard fee         disclosed separately
------------------------------------------
One review / one approval experience
```

A cart receives a stable `batchIntentId` and a cryptographic commitment over the ordered set of claims. Any change to recipient, amount, currency, claim, or fee changes the commitment and requires fresh payer approval.

## Three execution modes

### Mode A — Atomic onchain multi-recipient payment

Best first implementation for stablecoins / agent payments.

The payer signs one batch authorization binding:

- all recipients;
- all amounts;
- token(s);
- total maximum;
- XGuard fee if applicable;
- expiry;
- batch nonce;
- batch commitment hash.

A batch router or compatible signature-transfer mechanism executes all transfers in one transaction. The transaction MUST revert as a whole when an atomic batch is required and any mandatory output cannot be paid.

XGuard never silently changes recipients or amounts after the payer signs.

### Mode B — Marketplace / platform split payment

For card, wallet, and local payment rails that already support multi-seller / split settlement.

XGuard supplies the allocation plan to the licensed payment platform. The platform performs the customer charge and books/transfers the specified shares to its onboarded recipient accounts.

XGuard is the cart, allocation, verification, receipt, and billing control layer; the regulated PSP remains the party moving fiat funds.

### Mode C — One approval UX, multiple underlying payments

When merchants live on unrelated rails that cannot legally or technically share one native transaction, XGuard can still provide one user confirmation that authorizes a bounded set of underlying payments. This is not represented as one acquiring transaction. The receipt explicitly shows each child payment and its status.

This mode requires a wallet, payment credential tokenization, agent mandate, or platform authority that is legally allowed to initiate the child payments.

## Batch Payment Intent

The signed batch intent contains:

- `version`
- `batchIntentId`
- `payer`
- `claims[]`
- `totals[]` grouped by currency / asset
- `fees[]`
- `executionPolicy`
- `atomicityPolicy`
- `validBefore`
- `nonce`
- `claimsRoot`
- payer authorization / signature

### Atomicity policies

- `ALL_OR_NOTHING` — all mandatory claims settle or the batch fails.
- `BEST_EFFORT` — permitted claims may settle independently; failures are clearly itemized.
- `GROUP_ATOMIC` — claims are divided into atomic groups, useful when different rails cannot share one transaction.

The payer must see the chosen policy before approval.

## Claim reservation

Before approval, XGuard can reserve each claim for a short window so prices and availability do not change during checkout. A merchant can answer:

```text
RESERVED until 12:03:30Z
```

or

```text
REQUOTE_REQUIRED
```

A batch cannot be signed against stale claims.

## Settlement receipt

XGuard produces one parent receipt with child results:

```text
Batch XG-...
TOTAL: ...

Claim A -> PAID -> merchant A -> provider reference
Claim B -> PAID -> merchant B -> provider reference
Claim C -> FAILED / REFUNDED / PENDING
XGuard fee -> ...
```

The receipt binds the exact batch commitment the payer approved.

## Refunds

Refunds remain attributable to the original child claim. XGuard can offer a unified refund interface, but it must preserve each merchant / provider's actual refund authority and rules.

## Revenue

XGuard can monetize without silently skimming merchant proceeds:

- disclosed batch convenience fee paid by the payer;
- platform / rail fee paid by the integrating payment provider;
- small per-child settlement fee;
- share of an existing marketplace/platform fee when contractually supported;
- premium merchant funding / reconciliation services.

The commercial model can differ by rail.

## First product wedge

The fastest defensible wedge is **stablecoin / agentic commerce**:

1. participating x402 / wallet / agent services expose XGuard Payment Claims;
2. a wallet or agent accumulates claims over a session;
3. the payer sees one XGuard cart;
4. payer signs one batch authorization;
5. an atomic batch router sends the exact amounts to all recipients;
6. XGuard emits one parent receipt and child settlement proofs.

This avoids pretending that independent card merchants can be collapsed into one card-acquiring transaction without a licensed marketplace/payment platform.

## Necessary-layer thesis

XGuard becomes valuable when many services want to be included in a payer's universal cart. A merchant that exposes a compatible Payment Claim becomes payable inside the one-click batch experience. A wallet that supports XGuard can pay many services with one approval instead of forcing the user through many checkouts.

The network effect target is:

> **If you want to be included in Pay-All checkout, expose an XGuard-compatible claim.**
