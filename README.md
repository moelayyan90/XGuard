# XGuard Reliability Gateway

A non-custodial reliability layer for production x402 servers.

**Production:** https://api.xguardgate.com  
**Website:** https://xguardgate.com  
**Standalone timeout reconciliation:** https://reconcile.xguardgate.com

## What XGuard does

- Drop-in `/supported`, `/verify`, `/settle` facilitator surface
- Health-aware multi-facilitator routing
- Direct Base polling after settlement errors to catch late confirmations
- EIP-3009 authorization-state reconciliation before declaring failure
- Durable idempotency receipts for confirmed settlements
- Replayed settlement authorizations return the stored result instead of broadcasting again
- No custody, no private keys, no change to the signed amount or merchant recipient

## Pricing

- `/verify`: free
- First 25 successful routed settlements per merchant: free
- After that: 2 XGuard Usage Credits per successful routed settlement
- Failed settlements: no credits consumed
- No subscription

Usage credits: https://lfsystems.lemonsqueezy.com/checkout/buy/f4c81819-1b10-4f1d-995d-46206a889dab

## Integrate

Use XGuard as the facilitator URL:

```text
https://api.xguardgate.com
```

Paid volume sends the existing XGuard Usage Credits license key on settlement requests:

```http
Authorization: Bearer YOUR_XGUARD_LICENSE_KEY
```

A confirmed settlement includes:

```http
X-XGuard-Receipt-Id: xgr_...
X-XGuard-Resolution: upstream | authorization_recovered | confirmed_late
```

Retrieve a durable receipt:

```http
GET https://api.xguardgate.com/v1/receipts/xgr_...
```

## Why this exists

A facilitator can stop waiting before a Base transaction confirms. That creates a gap where the client sees failure even though USDC may settle later. XGuard keeps the server in the payment path long enough to reconcile that state and makes confirmed results idempotent across retries.
