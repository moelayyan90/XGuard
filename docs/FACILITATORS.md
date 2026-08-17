# Facilitator integration policy

## Live mainnet route

XGuard production currently uses one Base-compatible downstream route:

- `xpay`
  - origin: `https://facilitator.xpay.sh`
  - protocol: x402 v2
  - scheme: `exact`
  - network: `eip155:8453` (Base mainnet)
  - asset: native Base USDC
  - authorization mechanism: EIP-3009
  - provider authentication: none required by the public xpay facilitator
  - xpay protocol fee: `0`
  - XGuard service fee: `2,000` micro-USD (`$0.002`)

The production Worker refreshes xpay health on scheduled maintenance and refuses stale or incompatible routing. `/readyz` is not considered ready unless the mainnet route is fresh and operational.

Official xpay documentation identifies `https://facilitator.xpay.sh` as its public facilitator, supports Base mainnet and Base Sepolia, and advertises zero protocol fees with sponsored gas. See [xpay facilitator documentation](https://docs.xpay.sh/en/x402-protocol/facilitator) and the [xpay facilitator announcement](https://www.xpay.sh/blog/article/xpay-x402-facilitator/).

### Downstream-cost and quota policy

The checked-in mainnet configuration currently sets the xpay downstream protocol-cost floor to `0` micro-USD, matching xpay's published zero-fee facilitator terms. This is not a guarantee that all future provider, infrastructure, gas-sponsorship, account, tax, or operating costs remain zero.

Runtime/observed downstream cost can override the configured floor. XGuard uses the maximum of configured, runtime, and recent observed downstream cost when evaluating unit economics. A route becomes ineligible if protected gross-margin requirements are not satisfied.

xpay currently publishes facilitator rate limits of 100 verify requests/minute and 50 settle requests/minute. XGuard deliberately uses lower global upstream guards of 90 verify/minute and 45 settle/minute so it can fail locally before saturating the published provider limit.

Provider plan changes and actual operating expenses remain separate accounting facts. A configured route-cost value must never be described as the owner's final profit.

Some historical internal identifiers still contain `payai` wording for compatibility with existing persisted state. Those identifiers do **not** change the live production origin or external provider attribution: the current downstream is xpay at `facilitator.xpay.sh`.

## Optional testnet candidates

The separate Base Sepolia Worker is manual-only and non-billable. Its test configuration may use compatible Base Sepolia facilitators for explicit integration testing. Testnet state remains isolated from mainnet merchant balances and earned revenue and is not part of automatic production monitoring.

## Transport boundary

- origins are operator configuration, never request-controlled URLs;
- only HTTPS is accepted outside localhost development;
- redirects use `manual` handling and are rejected;
- response status, media type, byte length, JSON structure, and settlement identity are validated;
- provider credentials, when a future provider requires them, belong only in encrypted deployment secrets;
- private keys are not accepted from merchants and are not stored by XGuard.

## Routing and failover

Verification may use a different compatible route only where that operation submits no value. Settlement selects exactly one route before the outbound boundary. Once submission starts, XGuard never sends the same authorization to a second facilitator. Unknown outcome becomes `AMBIGUOUS` and requires independent finality/reconciliation.

Normal billable routing requires a current attributable downstream-cost value and positive protected unit economics after the `$0.002` XGuard fee. A route with unknown or excessive cost is ineligible.

## Adding or replacing a mainnet route

A new route is not enabled merely because it responds. It must have:

1. an attributable provider endpoint and current terms/pricing;
2. scoped credentials in encrypted secrets if authentication is required;
3. measured `/supported` compatibility for the exact mainnet network/mechanism;
4. bounded transport and strict response validation;
5. a current downstream-cost value with positive unit economics;
6. explicit non-production verification plus real authorized mainnet settlement, duplicate/replay, timeout, ambiguity, and reconciliation evidence before production promotion;
7. independent chain-finality verification before a successful settlement can earn an XGuard fee;
8. recurring operational monitoring, rollback, and incident ownership.

Adding a second mainnet route must preserve the one-outbound-owner rule: failover must never create duplicate settlement submission after the first route has crossed the outbound boundary.
