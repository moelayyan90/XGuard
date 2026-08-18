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
  - provider authentication: none required by the currently configured public route

The production Worker refreshes downstream health during scheduled maintenance and refuses stale or incompatible routing. `/readyz` is not considered ready unless the required mainnet route is fresh and operational.

## XGuard fee versus downstream cost

The canonical XGuard public x402 charge is **$0.03 (30,000 micro-USD) once per accepted authenticated economic attempt**. It is an XGuard service-accounting event and is distinct from any xpay protocol fee, gas sponsorship, RPC expense, infrastructure expense or future commercial provider charge.

The attempt fee is earned before downstream execution after authentication, supported-request parsing, canonical `logicalPaymentKey` derivation and successful prepaid-balance reservation. Downstream failure does not refund an accepted attempt. Idempotent retries add no second attempt fee.

Do not describe a configured downstream-cost floor as the owner's total cost or profit. Runtime/observed downstream cost and external provider terms remain separate accounting evidence.

### Downstream-cost and quota policy

The checked-in mainnet configuration carries the current attributable downstream protocol-cost floor used by XGuard's route economics. That value is a routing input, not a permanent guarantee about provider, infrastructure, gas-sponsorship, account, tax, RPC, monitoring or operating costs.

Runtime/observed downstream cost can override a configured floor. XGuard evaluates current attributable cost before using it for economic controls. Provider quotas and terms must be treated as changeable external facts and verified against the provider's current authoritative documentation or contract before scale decisions.

Some historical internal identifiers may still contain `payai` wording for compatibility with persisted state. Those identifiers do **not** change the live external provider attribution: the production provider manifest identifies the current downstream as xpay.

## Optional testnet candidates

The separate Base Sepolia Worker is manual-only and non-billable. Its test configuration may use compatible Base Sepolia facilitators for explicit integration testing. Testnet state remains isolated from mainnet merchant balances and earned revenue and is not part of automatic production monitoring.

## Transport boundary

- origins are operator configuration, never request-controlled URLs;
- only HTTPS is accepted outside localhost development;
- redirects use `manual` handling and are rejected where financial routing requires it;
- response status, media type, byte length, JSON structure and settlement identity are validated;
- provider credentials, when a provider requires them, belong only in encrypted deployment secrets;
- private keys are not accepted from merchants and are not stored by XGuard.

## Routing and failover

Verification may use a different compatible route only where that operation submits no value. Settlement selects exactly one route before the outbound boundary. Once submission starts, XGuard never sends the same authorization to a second facilitator. Unknown outcome becomes `AMBIGUOUS` and requires independent finality/reconciliation.

The fixed XGuard attempt fee and the downstream settlement state are separate concerns: an accepted attempt can be billed even if the later downstream result is failure or ambiguity, while settlement truth still follows fail-closed reconciliation rules.

## Adding or replacing a mainnet route

A new route is not enabled merely because it responds. It must have:

1. an attributable provider endpoint and current terms/pricing;
2. scoped credentials in encrypted secrets if authentication is required;
3. measured `/supported` compatibility for the exact mainnet network/mechanism;
4. bounded transport and strict response validation;
5. a current attributable downstream-cost value suitable for the relevant economic controls;
6. explicit non-production verification plus authorized mainnet settlement, duplicate/replay, timeout, ambiguity and reconciliation evidence before production promotion;
7. independent chain-finality verification for settlement truth;
8. recurring operational monitoring, rollback and incident ownership.

Adding a second mainnet route must preserve the one-outbound-owner rule: failover must never create duplicate settlement submission after the first route has crossed the outbound boundary.
