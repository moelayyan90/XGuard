# Unit economics

All XGuard monetary values use exact integer micro-USD.

For each normal mainnet route:

```text
$0.002 XGuard service fee
- downstream facilitator cost attributable to XGuard
- variable infrastructure cost
= contribution per successful billable settlement
```

Contribution is not owner profit. Fixed infrastructure, refunds/customer liabilities, provider fees, taxes, reserve requirements, off-ramp costs, and any other operating expenses remain separate.

## Current live route assumption

The live Base mainnet Worker is configured with:

```text
XGuard fee:                         $0.002000
Conservative PayAI route cost:     $0.001000
Configured contribution:           $0.001000
```

The `1,000` micro-USD downstream-cost value deliberately uses PayAI's currently advertised pay-as-you-go rate rather than assuming its free allowance will always apply. PayAI's public facilitator pricing page, checked 2026-08-15, advertises:

- Free Forever: 10,000 settlements per month at $0;
- Pay As You Go: $0.001 per settlement;
- Enterprise: custom terms.

Official pricing source: `https://facilitator.payai.network/`.

This means the configured `$0.001` contribution is conservative during the advertised free allowance and approximately represents fee minus facilitator cost after the free allowance, before all other costs. Pricing can change and must be refreshed from the provider's current tariff or contract.

## What is and is not revenue

Merchant Base USDC top-ups are prepaid service balances and are recorded as customer liabilities. They are not XGuard revenue when they arrive at the treasury.

For one eligible settlement, XGuard reserves `2,000` micro-USD from the merchant service balance. The fee becomes `EARNED_REVENUE` only after independent Base finality verifies the successful native-USDC settlement. Definitive failure releases the reservation. Ambiguity remains held for reconciliation.

Therefore:

```text
USDC received as merchant top-up != revenue
$0.002 reserved fee               != revenue yet
$0.002 finality-confirmed fee     = gross XGuard earned revenue
contribution after route cost     != final owner profit
```

## Live-state reporting rule

The public mainnet endpoint is technically deployed and passes readiness checks. This document does not invent a customer-volume, revenue, or profit number. Actual billable settlements and earned revenue must be read from the production accounting ledger and reconciled against treasury/provider evidence before being reported as actual results.

## Break-even examples

Using the conservative `$0.001` per-settlement contribution before other variable/fixed costs:

| Additional monthly cost | Settlements needed just to cover it |
| ----------------------: | ----------------------------------: |
|                   $5.00 |                               5,000 |
|                  $25.00 |                              25,000 |
|                 $100.00 |                             100,000 |

These are arithmetic break-even examples, not traffic or revenue forecasts.

The route engine fails closed when the configured attributable downstream cost is unknown or is not lower than the XGuard service fee. Network gas paid by another participant is disclosed but is not booked as XGuard expense unless XGuard actually incurs it.
