# XGuard Rail Distribution Strategy

## Goal

XGuard is distributed once at the payment-rail / facilitator / gateway layer so every eligible merchant settlement behind that integration receives XGuard settlement-truth, replay, finality, and ambiguity-recovery protection without merchant onboarding.

The canonical distribution unit is **one rail integration**, not one merchant integration.

## Economics

XGuard's commercial target is a minimum **$0.02 contribution profit per independently finalized billable settlement**.

`contribution profit` means rail service revenue minus attributable variable costs for that settlement (downstream facilitator cost, chain/RPC cost attributable to the operation, paid infrastructure usage, and other directly measurable per-settlement costs). It is intentionally not described as company-wide accounting net income, which also depends on fixed overhead, tax, legal, payroll, and other period costs.

For a rail contract, the minimum billable amount per finalized settlement is therefore:

```text
rail service fee >= attributable variable cost + $0.02
```

The merchant's buyer-authorized `amount` and `payTo` remain unchanged. The rail operator pays XGuard separately under the infrastructure agreement.

For very small x402 payments, the XGuard rail fee does not need to be transferred as a second onchain payment for every request. It can accrue as an idempotent rail receivable and be invoiced / settled in aggregate. This prevents a two-cent service fee from modifying or invalidating a sub-cent buyer payment.

No fee is earned for definitive failure, unresolved ambiguity, or duplicate replay of the same logical payment.

## Platform-neutral adapter contract

XGuard must not depend on xpay-specific request ownership in the canonical rail architecture. Every rail adapter should expose equivalent internal operations:

- `identifyRailPrincipal()` — authenticate the infrastructure partner, not the merchant;
- `capabilities()` — networks, schemes, assets, signer/settler identity, limits;
- `prepare(payment)` — strict validation, replay identity, one-outbound-owner reservation;
- `observeSubmission(evidence)` — record the rail's outbound boundary without creating a second submission;
- `resolve(payment)` — establish `FINALIZED`, `PENDING`, `PROVEN_FAILED`, or `CONFLICT` from independent evidence;
- `accrueFee(payment)` — create exactly one finality-gated rail receivable only when commercial and cost floors are satisfied;
- `exportUsage()` — bounded partner reconciliation / invoice evidence.

Adapters must preserve the merchant payment exactly and must never obtain authority to rewrite a buyer-signed `exact` transfer.

## Distribution targets

### Tier 1 — production facilitators / rails

These are the highest-leverage targets because one integration can cover many sellers.

1. Coinbase CDP x402 Facilitator
2. PayAI facilitator / agentic-payments infrastructure
3. xpay facilitator
4. Polygon Labs x402 facilitator
5. Other production x402 facilitators that expose a stable verify/settle boundary
6. Self-hosted enterprise facilitators

### Tier 2 — infrastructure platforms embedding x402

These can distribute XGuard as a built-in payment-safety option or internal module for deployments created on the platform.

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

The narrow pitch is:

> Add XGuard once behind your settlement boundary. Your sellers do nothing. XGuard independently resolves post-submit ambiguity, prevents unsafe duplicate settlement behavior, and provides finality/reconciliation evidence. We bill the rail only for independently finalized protected settlements under a separate B2B agreement.

## Rollout order

1. Finish generic rail principal + rail receivable primitives.
2. Implement xpay as the first adapter because XGuard already routes through it and can validate the interface against known production behavior.
3. Implement a CDP-compatible adapter contract without hard-coding credentials or merchant assumptions.
4. Implement PayAI and Polygon-compatible capability adapters.
5. Publish the adapter contract for self-hosted facilitators.
6. Submit XGuard to official x402 ecosystem/developer-tool channels and open targeted integration proposals with rail maintainers.
7. Add Cloudflare/AWS/Vercel/Stripe integration guides only where a real supported x402 execution boundary exists; do not claim native integration before partner acceptance.

## Success metric

The primary growth metric is:

```text
independently finalized settlements protected by XGuard per day
```

Secondary metrics:

- rails integrated;
- eligible merchant endpoints inherited through those rails;
- protected settlement success / ambiguity-resolution rate;
- earned contribution profit per finalized settlement;
- aggregate contribution profit per rail.

Merchant registrations, API keys issued, and prepaid balances are legacy metrics and are not canonical growth KPIs for rail-embedded XGuard.
