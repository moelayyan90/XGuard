# Unit economics

All monetary values use exact integer micro-USD.

For each normal mainnet route:

```text
$0.002 XGuard service fee
- downstream facilitator cost attributable to XGuard
- variable infrastructure cost
= contribution per successful billable settlement
```

The route engine rejects a normal billable path when attributable downstream cost is unknown or already exceeds the XGuard fee. An explicitly configured test/recovery/promotion exception must be transparent and separately accounted.

## Current actual state

The public testnet Worker is deployed and real Base Sepolia USDC settlement has succeeded onchain. Testnet is explicitly non-billable, so actual billable settlements, gross XGuard revenue, contribution, treasury, and profit remain **$0.00**. The authorized Cloudflare deployment is on the Free plan and has created no external invoice. Mainnet downstream cost and per-settlement contribution remain unknown because no mainnet route, provider contract, or tariff is authorized.

## Illustrative cases, not actual results

| XGuard fee | Downstream cost | Variable infrastructure |           Contribution |
| ---------: | --------------: | ----------------------: | ---------------------: |
|     $0.002 |          $0.000 |                  $0.000 |                 $0.002 |
|     $0.002 |          $0.001 |                  $0.000 |                 $0.001 |
|     $0.002 |          $0.003 |                  $0.000 | -$0.001; route blocked |

A hypothetical $5 monthly platform cost would require 2,500 settlements at $0.002 contribution merely to cover that cost, before reserve, other expenses, or owner distribution. This is a break-even illustration, not a forecast.

Facilitator cost must be refreshed from an official tariff or contract before enabling its mainnet route. Network gas paid by a different participant is disclosed but is not recorded as XGuard expense unless XGuard actually incurs it.
