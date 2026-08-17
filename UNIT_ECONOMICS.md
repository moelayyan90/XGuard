# Unit economics

All XGuard monetary values use exact integer micro-USD.

## Zero-friction x402 seller revenue

For one independently finalized successful merchant settlement:

```text
proportional fee = floor(settlement_amount_micro_usd × signed_fee_bps / 10,000)
XGuard gross fee = min(proportional fee, signed_fee_cap_micro_usd)
```

At the current default signed terms:

```text
signed fee rate:  50 bps = 0.5%
signed fee cap:   1,000 micro-USD = $0.001
```

Examples:

| Merchant settlement | Gross XGuard fee |
| ---: | ---: |
| $0.01 | $0.00005 |
| $0.10 | $0.00050 |
| $0.20 | $0.00100 |
| $1.00 | $0.00100 |
| $100.00 | $0.00100 |

Verification, definitive failure, unresolved ambiguity and idempotent retry do not create another zero-friction x402 fee.

## Contribution

For each finalized billable settlement:

```text
XGuard gross earned fee
- attributable downstream facilitator/provider cost
- variable Cloudflare / D1 / Durable Object cost
- attributable RPC/finality cost
- other variable operating cost
= contribution
```

Contribution is not owner profit. Fixed infrastructure, taxes, reserves, legal/compliance expense, off-ramp cost, charge/reconciliation exposure and other operating costs remain separate.

## Downstream-cost rule

Do not invent a provider cost from an old tariff, free-tier advertisement or historical snapshot. The current downstream submitter is xpay; the actual XGuard-attributable downstream cost must be taken from current provider terms, contract or measured invoices/usage.

If a downstream provider charges more than the XGuard fee available under a merchant's signed pricing terms, the route is economically ineligible unless there is another defensible source of margin. XGuard must fail closed or introduce a new disclosed pricing version for future merchant activations; it must not silently rewrite existing signed terms.

## Revenue recognition

For the zero-friction x402 seller path:

```text
merchant activation signature            != revenue
buyer payment to merchant payTo          != XGuard revenue
pending downstream success               != XGuard revenue
unresolved ambiguous settlement          != XGuard revenue
independently finalized XGuard fee event = gross XGuard earned revenue
service-fee payment received              = credit against XGuard receivable
```

The buyer payment remains the merchant's payment. XGuard records a separate postpaid service receivable only after finality.

Legacy prepaid universal-gateway balances remain customer liabilities until their own legacy revenue-recognition boundary is met; they are separate from the zero-friction seller model.

## Break-even formula

Because the XGuard fee varies with merchant payment size until it reaches the cap, there is no single honest settlement-count break-even number without traffic mix and measured cost data.

For a measured period:

```text
average contribution per finalized billable settlement
  = (earned XGuard fees - attributable variable costs)
    / finalized billable settlements

settlements needed to cover fixed cost
  = fixed cost / average contribution per settlement
```

Only use this after real production data exists. Revenue is not profit, and settlement count is not a profit guarantee.

## Reporting rule

Actual customer volume, earned revenue, outstanding receivables, contribution and profit must come from production accounting plus treasury/provider evidence. This document intentionally does not invent customer demand or future profit.
