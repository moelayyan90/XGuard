# Facilitator integration policy

## Current testnet candidates

The Worker release configuration contains two Base Sepolia candidates:

- `x402-org-testnet`
  - origin: `https://x402.org/facilitator`
  - protocol: x402 v2
  - scheme: `exact`
  - network: `eip155:84532` (Base Sepolia)
  - authorization mechanisms: EIP-3009 and Permit2
  - configured downstream cost: `0` micro-USD for the non-billable testnet route
- `payai-testnet`
  - origin: `https://facilitator.payai.network`
  - protocol: x402 v2
  - scheme: `exact`
  - network: `eip155:84532` (Base Sepolia)
  - authorization mechanism: EIP-3009
  - configured downstream cost: `0` micro-USD for the non-billable testnet route

A configured candidate is not treated as usable merely because it appears in configuration. Capabilities are refreshed every five minutes and each candidate must independently pass the live `/supported` compatibility and freshness checks. XGuard advertises and routes only through fresh compatible candidates; stale, redirecting, malformed, or unavailable candidates degrade, open, or quarantine independently.

## Transport boundary

- origins are operator configuration, never request-controlled URLs;
- only HTTPS is accepted outside localhost development;
- redirects use `manual` handling and are rejected;
- response status, media type, byte length, JSON structure, and settlement identity are validated;
- temporary debug payload logging is forbidden;
- provider credentials, when required, belong only in encrypted deployment secrets.

## Routing and failover

Verification can try another compatible healthy route. Settlement selects exactly one route before the outbound boundary. Once submission starts, XGuard never sends the authorization to a second facilitator. Unknown outcome becomes `AMBIGUOUS` and requires independent reconciliation.

Normal billable routing requires a current attributable downstream cost and non-negative contribution after the `$0.002` XGuard fee. A route with unknown or excessive cost is ineligible.

## Adding a route

A new route is not enabled merely because it responds. It must have:

1. an authenticated, attributable provider endpoint when authentication is required;
2. scoped credentials in encrypted secrets, if authentication is required;
3. measured `/supported` compatibility for the exact network/mechanism;
4. bounded transport and strict response validation;
5. a current fee schedule and non-negative unit economics before billable use;
6. testnet verification, real settlement, duplicate/replay, timeout, ambiguity, and reconciliation evidence;
7. an independent chain-finality adapter before any mainnet success can finalize or bill;
8. operational alerts, provider-status monitoring, rollback, and incident ownership.

No mainnet route is enabled in this release.
