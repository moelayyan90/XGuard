# Pricing

## Recommended x402 seller path

XGuard's zero-friction x402 seller contract charges only after independent Base finality proves a successful settlement.

Current default terms:

- service share: **0.5%** (`50` basis points);
- maximum XGuard fee: **$0.001** (`1,000` micro-USD) per finalized successful settlement;
- `/verify`: **free**;
- failed settlement: **free**;
- unresolved ambiguous outcome: **no earned fee**;
- idempotent retry: **no additional fee**;
- monthly subscription: **none**;
- prepayment before first use: **none**;
- default unpaid-service-fee limit: **$1.00**.

These values are configured by:

```text
XGUARD_PRICING_VERSION
XGUARD_FEE_BPS
XGUARD_FEE_CAP_MICRO_USD
XGUARD_POSTPAID_LIMIT_MICRO_USD
```

The exact terms are included in the one-time merchant-wallet activation message and stored with the activated `payTo` address. A later runtime configuration change does not silently rewrite the pricing already accepted by an activated merchant.

## Fee formula

For one independently finalized successful settlement:

```text
proportional fee = floor(settlement_amount_micro_usd × fee_bps / 10,000)
XGuard fee       = min(proportional fee, fee_cap_micro_usd)
```

At the current defaults:

| Merchant settlement | XGuard fee |
| ---: | ---: |
| $0.01 | $0.00005 |
| $0.10 | $0.00050 |
| $0.20 | $0.00100 |
| $1.00 | $0.00100 |
| $100.00 | $0.00100 |

Sub-micro-USD results floor to zero rather than imposing a minimum fee that could consume a tiny payment.

## Why the fee is postpaid

An x402 `exact` authorization binds the buyer-approved recipient and value. XGuard therefore does **not** silently subtract its fee from the merchant payment or rewrite the recipient.

The buyer-authorized settlement remains exactly the merchant payment. The XGuard fee is a separate, disclosed postpaid service receivable that accrues only after XGuard independently proves final settlement.

## Revenue boundary

A service fee can be earned only when:

1. the merchant `payTo` completed signed activation under explicit pricing terms;
2. XGuard has a unique logical authorization identity;
3. at most one outbound settlement owner was allowed to submit;
4. the downstream result indicates success;
5. independent Base evidence proves the exact expected native-USDC transfer final;
6. the same logical payment has not already generated the XGuard fee.

No zero-friction x402 fee is earned for malformed requests, verification, definitive settlement failure, unresolved ambiguity, duplicate replay retrieval, health/readiness traffic, or testnet traffic.

## Legacy pricing

The repository still contains authenticated/prepaid universal-gateway features with their own execution prices. Those are legacy/optional surfaces and are not the recommended x402 seller contract above. Their prices must not be presented as a requirement to use XGuard `/verify` or `/settle` for an activated merchant.

Downstream facilitator costs, gas sponsorship, infrastructure, taxes, funding, conversion, and off-ramp costs remain separate accounting facts. Revenue is not the same as profit.
