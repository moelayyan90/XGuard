# XGuard Payment Retry Firewall

## Core product thesis

XGuard is a provider-neutral **payment retry firewall**. Its primary safety rule is:

> **No Retry Without Proof.**

A second money-moving attempt for the same logical payment MUST NOT be issued while a previous attempt has an ambiguous outcome. A retry is allowed only when XGuard has durable evidence that the prior attempt is terminal and safe to retry.

This turns XGuard from a passive trust badge into an execution control point for payment orchestration, failover, autonomous agents, and payment recovery.

## Why this exists

Payment processors already provide idempotency within their own request scope, but an orchestrator that moves a logical payment from one processor or rail to another after a timeout can create a new provider-side payment identity. A timeout can mean the first processor succeeded but the response was lost. Retrying on a different processor before resolving that ambiguity can therefore create two real authorizations or captures.

The XGuard firewall maintains one cross-rail logical-payment identity and controls whether a new attempt may exist.

## State machine

```text
NEW
  -> LEASED
  -> SUBMITTED
       -> FINALIZED
       -> PROVEN_FAILED
       -> AMBIGUOUS
             -> FINALIZED
             -> PROVEN_FAILED
             -> MANUAL_REVIEW
```

Rules:

- `FINALIZED` is terminal: no additional charge attempt is permitted.
- `AMBIGUOUS` is fail-closed for new money-moving attempts.
- `PROVEN_FAILED` may issue one bounded retry permit.
- exactly one live execution lease may exist for a logical payment at a time.
- duplicate provider webhooks and duplicate API responses update evidence but do not create new attempts.

## Universal logical payment identity

A logical payment is independent of any PSP-specific object ID. The canonical identity binds, at minimum:

- platform / rail principal;
- merchant or beneficiary identity;
- order / invoice / economic-intent reference;
- amount and currency or asset;
- operation class (`authorize`, `capture`, `sale`, `refund`, `payout`, `settle`);
- payer token/fingerprint where legally and technically appropriate;
- bounded validity window.

Raw card data or unnecessary PII must never be used as the identity.

## Execution lease

Before a money-moving attempt is submitted, the integrated rail obtains an XGuard execution lease:

```text
logicalPaymentId
attemptId
rail
operation
expiresAt
oneUseNonce
```

The lease is consumed when outbound submission begins. A consumed lease cannot be reused to create a second outbound attempt.

For high-availability integrations, the lease validator may run as an embedded/sidecar module at the rail so the happy path does not depend on a remote network round trip.

## Ambiguity resolver

If the provider response is missing, delayed, contradictory, or timed out, XGuard marks the attempt `AMBIGUOUS` and automatically gathers authoritative evidence using the provider adapter:

1. provider status/query API when available;
2. authenticated provider webhook/event stream;
3. acquirer/network/ledger status where exposed;
4. blockchain finality for onchain rails;
5. settlement/reconciliation files as a slower final source when real-time evidence is unavailable.

The resolver does not guess. Until evidence is sufficient, the payment remains ambiguous and a new money-moving attempt is denied.

## Retry Permit

A new attempt after a prior attempt is allowed only with a one-use, short-lived XGuard Retry Permit.

A permit binds:

- `logicalPaymentId`;
- prior `attemptId`;
- proof that the prior attempt is `PROVEN_FAILED` or otherwise contractually safe to retry;
- permitted next operation and rail;
- maximum amount / currency;
- expiry;
- one-use nonce;
- reason / policy decision;
- signature or authenticated rail assertion.

The permit is consumed atomically when the new attempt starts.

## Policy engine

The firewall can deny retries for more reasons than ambiguous outcome:

- hard / do-not-retry decline codes;
- scheme or processor retry restrictions;
- amount, recipient, currency or mandate mismatch;
- replayed authorization or agent mandate;
- duplicate order / invoice intent;
- exceeded retry count or retry window;
- unsafe rail change that loses required authentication or liability state.

## Where XGuard is inserted

### Payment orchestrator / PSP platform

```text
Merchant traffic
      -> Orchestrator
      -> XGuard lease / retry firewall
      -> Processor A / B / C
```

One platform integration can protect every eligible merchant payment behind that platform.

### x402 / agentic payments

```text
Agent payment intent
      -> XGuard consume-once guard
      -> facilitator / settlement rail
```

A replay, concurrent execution, or uncertain settlement cannot create a second outbound settlement until the previous attempt is resolved.

### Webhook-only processors

XGuard can run as an event-driven safety layer for status resolution and retry authorization. It cannot block an unrelated processor from executing a retry unless the orchestrator or payment platform has integrated XGuard into the execution path.

## User-facing behavior

The user does not need an XGuard account or API key. If a payment becomes ambiguous, the checkout should not display a false failure that encourages a second payment. Instead it can show a neutral state such as:

> `Payment is being confirmed — do not pay again.`

After resolution:

- success -> show confirmed payment;
- proven failure -> permit a safe retry;
- unresolved -> continue waiting / escalate according to rail policy.

## Commercial value

XGuard sells a **safety invariant**, not another checkout UI:

> A platform may route and retry aggressively for higher conversion, while XGuard prevents an ambiguous prior attempt from becoming a duplicate charge.

Commercial models can be per protected payment, per retry decision, per resolved ambiguous event, volume tiers, or platform licensing. Pricing remains rail-specific.

## Adoption target

The strongest target customer is not an individual merchant. It is a payment orchestrator, facilitator, wallet, marketplace, billing platform, acquirer gateway, or agent-payment platform that controls retries or routes a logical payment across multiple execution rails.

## Non-claims

XGuard cannot guarantee global exactly-once money movement on rails it cannot observe or control. The defensible guarantee is narrower:

> Within an authorized XGuard integration boundary, no second XGuard-approved money-moving attempt is created for the same logical payment while a previous attempt is unresolved.
