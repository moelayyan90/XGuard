# XGuard Invisible Payment-Rail Architecture

## Product invariant

The canonical XGuard business model is **payment-rail infrastructure**, not merchant SaaS.

A merchant using a payment rail that embeds XGuard must not need to:

- create an XGuard account;
- register with XGuard;
- receive or store an XGuard API key;
- install an XGuard SDK or package;
- top up an XGuard service balance;
- call an XGuard-specific endpoint from application code;
- change the merchant's advertised x402 amount or `payTo` recipient.

The merchant's existing payment contract remains intact. XGuard operates behind the payment rail/facilitator and provides settlement correctness, replay protection, finality truth, ambiguity recovery, and evidence as infrastructure supplied to the rail operator.

## Economic model

XGuard must not silently reduce the buyer-authorized merchant payment.

For `exact` x402 payments, the buyer-authorized amount and recipient remain unchanged. XGuard revenue is a **separate rail-level service fee** owed by the payment-rail/facilitator operator under an explicit commercial agreement.

Example accounting boundary:

1. Buyer authorizes the merchant payment exactly as advertised.
2. The rail/facilitator submits or routes settlement.
3. XGuard independently establishes settlement truth and recovery evidence.
4. A successful independently finalized settlement creates one XGuard rail-usage event.
5. The rail operator owes the configured XGuard fee for that usage event.
6. XGuard and the rail operator settle accumulated fees periodically or through an agreed automated treasury mechanism.

No merchant prepayment is required in the canonical model.

## Integration boundary

The **integration customer is the rail operator**, not every merchant behind it.

The rail operator integrates XGuard once through a private server-to-server or co-located infrastructure boundary. Merchant traffic then receives XGuard protection automatically.

The exact transport can vary by partner:

- XGuard can sit in the facilitator execution path;
- the facilitator can invoke an authenticated XGuard rail interface;
- the facilitator can run an XGuard-compatible settlement-truth module next to its execution service;
- an orchestration layer can route settlement through XGuard before or after the downstream submit boundary, provided XGuard's one-outbound-owner and no-blind-retry invariants are preserved.

This private rail integration is not a merchant-facing API product.

## Canonical request identity

Canonical production accounting and authorization should be keyed by a **rail principal** plus immutable payment identity, not a merchant XGuard account.

A protected request should resolve:

- `railId` — authenticated infrastructure partner;
- immutable x402 payment identity;
- payer;
- `payTo` merchant recipient;
- expected amount;
- authorization nonce and expiry;
- downstream route and settlement evidence.

The merchant may remain an observed payment recipient without becoming an XGuard account holder.

## Billing state

Canonical rail billing should be post-execution and independently finality-gated:

```text
Observed -> FinalityPending -> Earned
                         \-> NotEarned
```

A usage fee becomes earned only when XGuard's existing finality rules prove the expected settlement reached the intended state.

The rail ledger must support:

- one earned XGuard fee per immutable logical payment;
- idempotent replay handling;
- no fee for definitive failed settlement;
- no fee while ambiguity remains unresolved;
- per-rail aggregation;
- invoice/export or automated partner settlement;
- reconciliation and compensating corrections without destructive history edits.

## Legacy merchant surfaces

Existing merchant registration, API-key, service-balance, top-up, Buyer Pass, and direct hosted-gateway flows may remain temporarily for backward compatibility and diagnostics.

They are **not the canonical growth path** and must not be required for a merchant whose payment rail already embeds XGuard.

New product work must not make merchant onboarding a prerequisite for the rail-embedded path.

## Required code changes

The current mainnet supervisor contains three merchant-facing gates that must be bypassed or replaced for authenticated rail traffic:

1. `authorizeMerchantScope(...)` on `/verify` and `/settle`;
2. `preparePrepaidFee(...)` before protected execution;
3. `authenticateMerchant(...)` / `merchantId` inside protected-request inspection.

The rail path should replace these with:

1. `authorizeRailPrincipal(...)` using a credential controlled by the infrastructure partner;
2. no merchant prepaid-fee reservation;
3. `railId` plus immutable payment identity for accounting and recovery ownership;
4. post-finality rail fee accrual;
5. private rail-level usage/reconciliation surfaces.

Legacy merchant authentication remains isolated to legacy routes during migration.

## Safety invariants that do not change

The architecture change must preserve all existing financial-safety guarantees:

- strict x402 v2 / network / asset / amount / recipient validation;
- one durable settlement owner per immutable authorization;
- no blind second settlement submission after outbound submission starts;
- permanent replay binding;
- independent Base finality before release-safe success and fee recognition;
- durable ambiguity and recovery;
- strict outbound transport validation;
- bounded upstream rate and concurrency controls;
- idempotent accounting.

## Deployment sequence

1. Add rail-principal authentication and rail billing schema without changing current merchant behavior.
2. Add a rail-mode supervisor path that can process authorized rail traffic with no merchant API key or prepaid balance.
3. Move finality-gated revenue recognition from merchant balance deduction to rail receivable accrual for rail-mode traffic.
4. Add private rail reconciliation/usage export.
5. Validate with one real payment-rail partner and a canary traffic slice while preserving the existing downstream fallback.
6. Only after verified production evidence, make rail-embedded mode the public canonical architecture and relegate merchant SaaS onboarding to legacy/optional status.

## Commercial prerequisite

XGuard cannot lawfully or technically collect a fee from unrelated payment traffic that never passes through an authorized XGuard integration.

The zero-merchant-friction model therefore requires XGuard to be embedded by a facilitator, wallet, payment router, gateway, or comparable payment-rail operator that has authority to include XGuard in its infrastructure and to pay the agreed service fee.
