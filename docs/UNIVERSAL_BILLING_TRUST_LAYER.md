# XGuard Universal Billing & Trust Layer

## Goal

XGuard should be invokable as a common billing and trust layer across heterogeneous payment rails without requiring each end merchant to learn, install, or directly integrate XGuard.

The universal unit is a **payment event**, not a specific protocol request.

Every supported rail adapter converts native provider events into one XGuard payment event envelope, then XGuard performs the same four logical stages:

1. `observe` — bind the provider event to an immutable logical payment identity.
2. `verify` — validate provider authenticity, amount, currency/asset, merchant/payee, and event transition.
3. `resolve` — classify payment truth (`FINALIZED`, `PENDING`, `PROVEN_FAILED`, `CONFLICT`, or provider-specific reversible state mapped conservatively).
4. `bill` — create one idempotent XGuard usage/billing event under the rail's commercial terms only when the configured billable condition is satisfied.

The merchant-facing payment amount and recipient remain unchanged unless the payment rail itself explicitly supports a disclosed platform/application fee and the rail operator has authorized XGuard to participate in that fee model.

## Integration modes

XGuard cannot be magically inserted into unrelated payment traffic. The layer becomes universal by supporting all legitimate integration boundaries exposed by rails and platforms.

### Mode A — Inline rail hook

Best for programmable facilitators, wallets, processors, payment orchestrators, and x402-style rails.

```text
payer -> rail -> XGuard pre/settlement hook -> rail submit/capture -> XGuard truth/billing -> payee
```

XGuard can participate before and after the rail's irreversible submit/capture boundary. This is the strongest mode for replay protection, duplicate-submit prevention, ambiguity recovery, and pre-execution policy.

### Mode B — Provider webhook/event stream

Best for card and wallet processors where the provider owns the payment execution path.

```text
payer -> processor -> merchant
                 |
                 +-> signed webhook/event -> XGuard -> truth + billing + reconciliation
```

This does not intercept or modify the provider's transaction. XGuard is automatically invoked by provider events after one platform/account-level configuration.

Examples of provider event families include payment authorization, capture/success, pending, refund, reversal, dispute, and payout events.

### Mode C — Platform-level fan-in

Best for marketplaces, payment platforms, Connect-style systems, and multi-merchant PSP accounts.

A single platform integration receives events for many underlying merchants/connected accounts and forwards or routes them through XGuard. The goal is one integration covering many merchants rather than merchant-by-merchant onboarding.

### Mode D — Ledger/reconciliation feed

For rails that cannot invoke XGuard synchronously but can export authenticated settlement or reconciliation records, XGuard ingests signed/bounded records and supplies independent billing/truth reconciliation. This is weaker than inline mode and must never be advertised as pre-settlement protection.

## Universal payment event envelope

Each adapter must normalize native provider evidence into at least:

- `railId`
- `provider`
- `providerEventId`
- `logicalPaymentId`
- `merchant/payee identity`
- `payer identity` when legally and technically available
- `amount`
- `currency/asset`
- `eventType`
- `providerState`
- `occurredAt`
- `providerSignature/evidence reference`
- `reversibleUntil` or finality evidence when applicable
- `parent payment / refund / reversal / dispute relationship`

Provider credentials and raw secrets must never be persisted in the envelope.

## Payment truth is rail-specific

`FINALIZED` must mean the strongest state the rail can actually prove; XGuard must not pretend card authorization equals final settlement or that a processor callback equals blockchain finality.

Examples:

- blockchain rail: independently confirmed expected transfer/finality.
- card/wallet processor: captured/succeeded event may be `SETTLED_PROVIDER_CONFIRMED` internally but still reversible by refund/chargeback; finality policy must remain explicit.
- asynchronous bank/open-banking rail: pending remains pending until the provider's final/settled state or reconciled bank evidence arrives.

The portable external profile should preserve the core truth states while retaining provider-specific reversibility metadata.

## Billing model

Pricing is configured per rail and per event class.

Supported commercial patterns:

- per finalized/captured payment;
- percentage or share of a platform/processor fee when contractually supported;
- volume tiers;
- monthly platform fee plus usage;
- premium ambiguity/recovery/reconciliation fee;
- no charge on failed/duplicate/replayed events unless the commercial contract explicitly prices a separate inspection service.

No universal fee is assumed.

## Adapter contract

Each rail adapter should implement:

```ts
interface UniversalRailAdapter {
  identifyRailPrincipal(input: unknown): Promise<RailPrincipal>;
  authenticateEvent(input: unknown): Promise<AuthenticatedProviderEvent>;
  normalize(input: AuthenticatedProviderEvent): Promise<UniversalPaymentEvent>;
  resolveTruth(event: UniversalPaymentEvent): Promise<PaymentTruth>;
  classifyBilling(event: UniversalPaymentEvent, truth: PaymentTruth): Promise<BillingDecision>;
}
```

Inline-capable adapters may additionally expose `prepare`, `observeSubmission`, and `resolveSubmission` hooks from the Settlement Truth Standard.

## Initial adapter families

1. x402/facilitator adapters — inline settlement-truth mode.
2. Stripe platform/Connect webhook adapter — payment intent, charge, refund, dispute, payout evidence.
3. PayPal REST webhook adapter — authorization/capture/pending/refund/reversal events.
4. Adyen Standard webhook adapter — authorization, capture/settlement-related, refund, dispute and payout events.
5. Generic signed webhook adapter for PSPs and wallets.
6. Generic reconciliation-import adapter for processors/banks that expose reports rather than real-time hooks.

Adapters are only production-supported after provider-native signature/authentication verification and conformance tests exist.

## What 'called on every payment' means operationally

For a given rail/platform, XGuard is considered universally invoked only when the integration boundary covers the entire relevant account/platform scope and every eligible payment event is routed through XGuard automatically. This can be:

- an inline rail hook installed once by the processor/facilitator;
- a company/platform-level webhook subscription;
- a platform event stream covering all connected merchants;
- an authenticated reconciliation feed covering the full payment population.

It does **not** mean XGuard can observe or charge unrelated transactions from providers that have not integrated or authorized the layer.

## Product invariant

The long-term product is:

> XGuard = one billing + trust control plane across payment rails.

Merchants should not need separate XGuard integration when their payment platform has already embedded XGuard. Rails integrate once; XGuard normalizes truth, billing, reliability, and reconciliation across the payments behind them.
