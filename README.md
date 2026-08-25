# XGuard Relay

Fault-tolerant, non-custodial x402 facilitator routing for production merchants.

- Standard `/supported`, `/verify`, `/settle` surface
- Health-aware upstream selection
- Base EIP-3009 timeout reconciliation before failover
- No custody and no private keys: buyer USDC still moves directly to the merchant
- `/verify` is free
- 25 successful settlements per merchant are free for evaluation
- Paid settlement routing consumes 2 XGuard Usage Credits only after a successful settlement
- Buy credits: https://lfsystems.lemonsqueezy.com/checkout/buy/f4c81819-1b10-4f1d-995d-46206a889dab

Production: https://api.xguardgate.com

## Merchant configuration

Set your x402 facilitator URL to `https://api.xguardgate.com`.

For paid volume, send the Lemon Squeezy license key on settle requests:

```http
Authorization: Bearer YOUR_XGUARD_LICENSE_KEY
```

The payment authorization itself is never modified. XGuard does not receive buyer funds, hold merchant funds, or sign on behalf of either party.
