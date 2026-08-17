# Infrastructure cost evidence

## Historical bootstrap snapshot

The Cloudflare quota/pricing snapshot below was retrieved from official provider documentation on **2026-08-14** while XGuard was still validating its public testnet bootstrap. At that time, no paid service had been purchased and the observed externally invoiced testnet bootstrap cost was `$0.00`.

That historical testnet observation is **not evidence that the current `xguard-mainnet` production deployment costs `$0.00`**. The repository cannot see the owner's current Cloudflare billing statement. Current production cost must be taken from measured Cloudflare usage/billing plus any downstream provider, RPC, monitoring, backup, and off-ramp expenses.

## Cloudflare Free-plan planning snapshot from 2026-08-14

These values are retained only as the dated bootstrap planning record and must be re-checked against current official Cloudflare documentation before being used for a production decision:

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) was recorded as providing 100,000 Worker requests per day on the Free plan with a per-invocation CPU allowance.
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) was recorded as including daily row-read/write quotas and a Free storage allowance.
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) was recorded as limiting each Free database and providing Time Travel recovery.
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) was recorded as supporting SQLite-backed objects on Free with request, duration, row, and storage quotas.

The current production architecture uses Durable Objects for settlement/request coordination and D1 for merchant, billing, finality, reconciliation, and discovery state. Quotas are account-specific and provider terms can change; production decisions must use current official documentation and actual measured usage.

## Production cost evidence

For `xguard-mainnet`, record actual measured/invoiced costs rather than inferring them from the historical testnet bootstrap:

```text
gross XGuard earned revenue
- downstream facilitator/provider expense
- Cloudflare Workers / Durable Objects
- D1 storage and operations
- RPC/network services
- monitoring / observability / backup
- off-ramp / payout cost
- other infrastructure
= contribution
```

Merchant transaction value and prepaid merchant liability are not revenue or available operating cash.

If a provider currently reports zero invoiced cost for a period, record the billing/usage evidence and the covered period. Do not convert “free tier exists” into a claim that production cost is permanently zero.

## Upgrade rule

No paid upgrade is triggered merely because it exists. A change needs measured quota/saturation/reliability evidence, current official price, non-negative post-upgrade economics, sufficient earned available treasury after liabilities and reserve, and an authorized project payment instrument. No owner cash, invented card, or assumed credit is used.
