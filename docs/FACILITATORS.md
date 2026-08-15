# Facilitator integration policy

## Live mainnet route

XGuard mainnet currently uses one Base-compatible downstream route:

- `payai-mainnet`
  - origin: `https://facilitator.payai.network`
  - protocol: x402 v2
  - scheme: `exact`
  - network: `eip155:8453` (Base mainnet)
  - asset: native Base USDC
  - authorization mechanism: EIP-3009
  - XGuard service fee: `2,000` micro-USD (`$0.002`)

The production Worker refreshes facilitator health on its scheduled maintenance cycle and refuses stale or incompatible routing. `/readyz` is not considered ready unless the mainnet route is fresh and operational.

### Downstream-cost policy

PayAI publicly advertises a free tier and a paid usage tier. As of 2026-08-15, its public facilitator pricing page advertises 10,000 settlements/month free and `$0.001` per settlement on pay-as-you-go. Source: `https://facilitator.payai.network/`.

XGuard must not assume the free tier is permanent or unlimited. Production routing therefore uses a conservative paid-tier downstream cost of `1,000` micro-USD when evaluating unit economics. With a `$0.002` XGuard fee, the configured contribution before other infrastructure/operating expenses is `1,000` micro-USD per successful billable settlement.

Provider invoices, credits, plan changes, taxes, chain/provider charges, and other actual operating expenses remain separate accounting facts. A configured route-cost estimate must never be described as the owner's final profit.

PayAI documentation states that scaling beyond the free tier requires a merchant account, credits, and API credentials. XGuard supports `PAYAI_API_KEY_ID` and `PAYAI_API_KEY_SECRET` as encrypted deployment secrets when those credentials are activated. Source: `https://docs.payai.network/x402/facilitators/introduction`.

## Live testnet candidates

The separate Base Sepolia Worker contains two non-billable candidates:

- `x402-org-testnet`
  - origin: `https://x402.org/facilitator`
  - protocol: x402 v2
  - scheme: `exact`
  - network: `eip155:84532` (Base Sepolia)
  - authorization mechanisms: EIP-3009 and Permit2
- `payai-testnet`
  - origin: `https://facilitator.payai.network`
  - protocol: x402 v2
  - scheme: `exact`
  - network: `eip155:84532` (Base Sepolia)
  - authorization mechanism: EIP-3009

Testnet is non-billable and remains isolated from mainnet merchant balances and earned revenue.

## Transport boundary

- origins are operator configuration, never request-controlled URLs;
- only HTTPS is accepted outside localhost development;
- redirects use `manual` handling and are rejected;
- response status, media type, byte length, JSON structure, and settlement identity are validated;
- provider credentials belong only in encrypted deployment secrets;
- private keys are not accepted from merchants and are not stored by XGuard.

## Routing and failover

Verification may use a different compatible route only where that operation submits no value. Settlement selects exactly one route before the outbound boundary. Once submission starts, XGuard never sends the same authorization to a second facilitator. Unknown outcome becomes `AMBIGUOUS` and requires independent finality/reconciliation.

Normal billable routing requires a current attributable downstream-cost estimate and positive contribution after the `$0.002` XGuard fee. A route with unknown or excessive cost is ineligible.

## Adding or replacing a mainnet route

A new route is not enabled merely because it responds. It must have:

1. an attributable provider endpoint and current terms/pricing;
2. scoped credentials in encrypted secrets if authentication is required;
3. measured `/supported` compatibility for the exact mainnet network/mechanism;
4. bounded transport and strict response validation;
5. a current downstream-cost value with positive unit economics;
6. testnet verification, real settlement, duplicate/replay, timeout, ambiguity, and reconciliation evidence;
7. independent chain-finality verification before a successful settlement can earn an XGuard fee;
8. recurring operational monitoring, rollback, and incident ownership.

Adding a second mainnet route must preserve the one-outbound-owner rule: failover must never create duplicate settlement submission after the first route has crossed the outbound boundary.
