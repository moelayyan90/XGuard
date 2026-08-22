# XGuard Rail Pricing Registry

_Last reviewed: 2026-08-18_

This registry exists to prevent XGuard from using one universal fee across different payment rails.

## Rules

1. Re-verify each rail's public pricing before a commercial proposal is sent.
2. Never modify the buyer-authorized merchant amount or `payTo` to collect XGuard revenue.
3. Rail pricing is a separate B2B commercial arrangement.
4. XGuard earns only on eligible independently finalized usage under the relevant partner agreement.
5. Failed, unresolved, or duplicate logical settlements do not create a usage fee.
6. A proposed price is not market fact. It remains a proposal until the rail accepts it.
7. Prefer a small share of existing rail economics over a price that would make the rail uncompetitive.

## Current public anchors and proposal shapes

| Rail / platform | Current public economic anchor | XGuard proposal shape | Status |
|---|---|---|---|
| Coinbase CDP x402 | 1,000 transactions/month free, then $0.001/transaction | Small share of paid facilitator usage or enterprise/platform reliability fee; do not increase the merchant payment | Public pricing verified; direct sales channel required |
| PayAI | 10,000 settlements/month free; pay-as-you-go $0.001/settlement; Enterprise custom | Small share of paid settlements, Enterprise add-on, or platform reliability/recovery fee | Public pricing verified; official partnership form exists |
| xpay | Public facilitator advertises zero protocol fees and sponsored gas | Platform/reliability license, premium recovery add-on, or revenue share from paid xpay products; avoid forcing a per-tx surcharge on the free facilitator | Outreach sent |
| FareSide / x402-rs production | Custom production pricing / early-access positioning; free x402.rs facilitator is testnet only | Custom volume tiers, platform fee, or small per-finalized usage price aligned with FareSide's production contract | Outreach sent |
| thirdweb x402 | x402 facilitator is part of thirdweb infrastructure; thirdweb sells paid platform plans and usage infrastructure | Paid-infrastructure add-on, volume tier, or premium settlement-truth feature; not a universal merchant fee | Outreach sent |
| Questflow | Usage-based agent economy / agent wallet model | Small share of applicable platform execution economics, volume tier, or reliability fee | Outreach sent |
| Heurist | Agent/AI infrastructure with x402-compatible ecosystem presence | Rail-level usage or reliability fee based on current production economics | Outreach sent |
| Polygon first-party x402 facilitator | Public integration docs; no universal per-transaction price confirmed in current public documentation | Confirm commercial model first; then propose platform/usage arrangement | Business enquiry channel identified |
| Corbits | Public facilitator observed as zero-fee in third-party directories; re-verify with Corbits before quoting | If truly zero-fee, use platform/premium reliability arrangement rather than assumed per-tx revenue share | Contact channel unresolved |
| OpenFacilitator | Free/open-source public facilitator | Sponsorship, managed/premium reliability tier, enterprise module, or optional hosted XGuard add-on | Contact channel unresolved |
| Mogami | Public hosted facilitator advertises no fees | Paid reliability/recovery tier, enterprise module, or commercial hosted add-on | Contact channel unresolved |

## Negotiation algorithm

For each rail:

```text
1. Verify current rail pricing and direct attributable XGuard cost.
2. Identify where the rail already earns money: transaction fee, subscription, infrastructure plan, enterprise contract, premium tier, or sponsorship.
3. Choose the least disruptive XGuard revenue surface.
4. Propose a small share / add-on that leaves the rail's merchant pricing unchanged whenever possible.
5. Record accepted terms per rail.
6. Accrue XGuard receivables only after finality and only under accepted terms.
```

## Preferred price shapes

### Paid per-transaction rail

Use a negotiated fraction of the rail's existing paid settlement economics rather than a fixed XGuard fee.

### Free public facilitator with paid commercial products

Do not assume transaction-fee revenue exists. Price XGuard as a premium reliability/recovery module, enterprise platform license, or revenue share from the paid product that benefits from XGuard.

### Subscription / infrastructure platform

Use a monthly XGuard infrastructure add-on and, if justified, a very small usage component at high volume.

### Percentage-fee rail

Negotiate a percentage of the rail operator's own fee rather than a percentage of the merchant's underlying payment.

### Self-hosted facilitator

Offer XGuard as a licensed / hosted settlement-truth and recovery module with usage-based or deployment-based pricing.

## Principle

The goal is not to maximize the fee on one rail. The goal is to become embedded across many rails and accumulate independent positive-profit streams while remaining economically easy for each partner to adopt.
