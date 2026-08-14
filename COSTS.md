# Bootstrap infrastructure and costs

Research was retrieved 2026-08-14 from official provider documentation. No paid service was purchased. The public testnet Worker and D1 database are running on the authorized Cloudflare Free plan; the current actual externally invoiced operating cost remains **$0.00**. This is an observed bootstrap result, not a guarantee that future usage remains within free quotas.

## Selected zero-cash deployment

Cloudflare Workers Free is the current testnet deployment, not a guarantee of future suitability:

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) currently provides 100,000 Worker requests per day on the Free plan with 10 ms CPU per invocation; limits reset daily.
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) currently includes 5 million rows read/day, 100,000 rows written/day, and 5 GB total storage on Free.
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) limit each Free database to 500 MB and provide seven days of Time Travel.
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) now supports SQLite-backed objects on Free and currently includes 100,000 requests/day, 13,000 GB-s/day, 5 million rows read/day, 100,000 rows written/day, and 5 GB SQL storage/account. Exceeding a Free dimension stops further operations rather than charging an owner card.

The prepared edge architecture uses one Durable Object per immutable authorization for serialization and D1 for projections. Quotas are shared/account-specific and can change; deployment must re-check the official pages and measure actual usage.

## Expense ledger

Record every incurred amount, evidence/reference, finality, and category:

```text
gross XGuard revenue
- facilitator expense
- compute
- database/storage/backup
- network/egress
- monitoring/alerting
- off-ramp/payout
- other infrastructure
= contribution
```

Merchant transaction value and prepaid liability are not revenue or available operating cash.

## Upgrade rule

No paid upgrade is triggered merely because it exists. A change needs measured quota/saturation/reliability evidence, current official price, non-negative post-upgrade economics, sufficient earned available treasury after liabilities and reserve, and an authorized project payment instrument. No owner cash, invented card, or assumed credit is used.
