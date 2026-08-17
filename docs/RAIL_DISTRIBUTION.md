# XGuard Rail Distribution Strategy

## Goal

XGuard is distributed once at the payment-rail / facilitator / gateway layer so every eligible merchant settlement behind that integration receives XGuard settlement-truth, replay, finality, and ambiguity-recovery protection without merchant onboarding.

The canonical distribution unit is **one rail integration**, not one merchant integration.

## Economics: per-rail pricing, not one universal fee

XGuard must not use one fixed per-settlement price across every platform. Each rail has different transaction pricing, gas sponsorship, network mix, merchant prices, volume, and commercial constraints.

For every prospective rail integration, XGuard records the rail's current published pricing and attributable variable costs, then proposes the smallest commercially acceptable XGuard fee that leaves positive contribution profit and does not make the rail uneconomic.

Canonical rule:

```text
XGuard rail price = negotiated per-rail price
XGuard contribution = XGuard rail price - directly attributable XGuard variable cost
accept integration only when expected contribution > 0
```

Pricing shapes may differ by rail:

- per-finalized-settlement fee;
- percentage of the rail operator's own transaction fee;
- volume tiers;
- monthly platform fee plus a lower usage fee;
- premium settlement-truth/recovery fee;
- aggregate receivable settled periodically rather than one separate onchain payment per merchant transaction.

The merchant's buyer-authorized `amount` and `payTo` remain unchanged. The rail operator pays XGuard separately under the infrastructure agreement. No fee is earned for definitive failure, unresolved ambiguity, or duplicate replay of the same logical payment.

## Current public pricing anchors

Pricing must be re-verified before every commercial proposal.

- Coinbase CDP x402 Facilitator: first 1,000 transactions/month free, then $0.001/transaction according to current official CDP documentation.
- xpay: currently advertises zero protocol fees and sponsored Base gas; XGuard therefore cannot assume a per-transaction fee budget exists and should propose a premium reliability/recovery, platform, or revenue-share arrangement instead.
- PayAI: official documentation advertises a free tier and authenticated production tiers, but current public pages are inconsistent on the free-tier settlement count; do not invent a production unit price. Quote only after the current commercial tier is confirmed with PayAI.
- Polygon: Polygon publishes a first-party x402 facilitator and multiple alternative facilitators. Public docs currently emphasize access/integration rather than a universal published per-transaction price; commercial pricing must be confirmed before quoting.

## Platform-neutral adapter contract

XGuard must not depend on xpay-specific request ownership in the canonical rail architecture. Every rail adapter should expose equivalent internal operations:

- `identifyRailPrincipal()` — authenticate the infrastructure partner, not the merchant;
- `capabilities()` — networks, schemes, assets, signer/settler identity, limits;
- `pricingSnapshot()` — timestamped source-backed rail pricing/cost assumptions;
- `prepare(payment)` — strict validation, replay identity, one-outbound-owner reservation;
- `observeSubmission(evidence)` — record the rail's outbound boundary without creating a second submission;
- `resolve(payment)` — establish `FINALIZED`, `PENDING`, `PROVEN_FAILED`, or `CONFLICT` from independent evidence;
- `accrueFee(payment)` — create exactly one finality-gated rail receivable under that rail's agreed pricing contract;
- `exportUsage()` — bounded partner reconciliation / invoice evidence.

Adapters must preserve the merchant payment exactly and must never obtain authority to rewrite a buyer-signed `exact` transfer.

## Distribution targets

### Tier 1 — production facilitators / rails

1. Coinbase CDP x402 Facilitator
2. PayAI facilitator / agentic-payments infrastructure
3. xpay facilitator
4. Polygon Labs x402 facilitator
5. Thirdweb x402 facilitator/infrastructure
6. Corbits facilitator/proxy infrastructure
7. Questflow and other production x402 facilitators
8. x402.rs and other open-source facilitators
9. Self-hosted enterprise facilitators

### Tier 2 — infrastructure platforms embedding x402

- Cloudflare Workers / Agents
- AWS agent/payment infrastructure
- Vercel x402/MCP deployments
- Stripe stablecoin/x402 infrastructure
- other x402 Foundation infrastructure members with an execution boundary suitable for settlement-truth integration

### Tier 3 — protocol and ecosystem distribution

- x402 Foundation developer tools / facilitator ecosystem listing
- MCP and agent registries
- public facilitator comparison / discovery directories
- open-source facilitator implementations where XGuard can be offered as an optional settlement-truth module

## Partner pitch

The rail operator should not be asked to migrate merchants or modify merchant prices.

> Add XGuard once behind your settlement boundary. Your sellers do nothing. XGuard independently resolves post-submit ambiguity, prevents unsafe duplicate settlement behavior, and provides finality/reconciliation evidence. Pricing is adapted to your existing rail economics rather than forcing one universal XGuard fee.

## Rollout order

1. Finish generic rail principal + rail receivable primitives.
2. Implement xpay as the first adapter because XGuard already routes through it and can validate the interface against known production behavior.
3. Implement CDP-, PayAI-, Polygon-, Thirdweb-, Corbits-, Questflow-, and x402.rs-compatible adapter contracts without merchant-specific assumptions.
4. Publish the adapter contract for self-hosted facilitators.
5. Submit XGuard to official ecosystem/developer-tool channels and open targeted integration proposals with rail maintainers.
6. Add Cloudflare/AWS/Vercel/Stripe integration guides only where a real supported x402 execution boundary exists; never claim native integration before partner acceptance.
7. Maintain a pricing registry that re-verifies each rail's public commercial terms before proposals are generated.

## Success metric

Primary metric:

```text
independently finalized settlements protected by XGuard per day across all rails
```

Secondary metrics:

- rails integrated;
- eligible merchant endpoints inherited through those rails;
- protected settlement success / ambiguity-resolution rate;
- contribution profit per rail;
- aggregate contribution profit across all rails.

Merchant registrations, API keys issued, and prepaid balances are legacy metrics and are not canonical growth KPIs for rail-embedded XGuard.
