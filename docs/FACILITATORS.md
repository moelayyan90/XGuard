# Facilitator integration policy

## Live mainnet route

XGuard production currently uses one Base-compatible downstream settlement route:

- provider: `xpay`
- origin: `https://facilitator.xpay.sh`
- protocol: x402 v2
- scheme: `exact`
- network: `eip155:8453` (Base mainnet)
- asset: native Base USDC
- authorization mechanism: EIP-3009
- provider authentication: none on the current public xpay route
- configured downstream protocol-cost floor: `0` micro-USD

XGuard is the merchant-facing gateway/safety layer; xpay is the current downstream transaction submitter. XGuard must not claim ownership of the downstream xpay signer.

## XGuard merchant fee

For the recommended zero-friction x402 seller path, the current default XGuard terms are:

- 0.5% of an independently finalized successful merchant settlement;
- maximum $0.001 XGuard fee per settlement;
- verify, failure and unresolved ambiguity are free;
- no prepaid balance before first use;
- one signed merchant-wallet activation followed by keyless `/verify` and `/settle`.

The merchant's signed activation terms, not a later silent configuration change, determine the fee for that activated `payTo`.

## Route health

The production Worker refreshes downstream health on scheduled maintenance and refuses stale or incompatible routing. `/readyz` is not considered ready unless the mainnet route is fresh and operational.

Published provider terms are evidence for configured downstream cost, not a guarantee of XGuard profit. Runtime/observed cost, infrastructure, gas sponsorship, provider plan changes, taxes and other operating costs remain separate accounting facts.

## Transport boundary

- origins are operator configuration, never request-controlled URLs;
- only HTTPS is accepted outside localhost development;
- redirects are rejected;
- response status, media type, byte length, JSON structure and settlement identity are validated;
- provider credentials, if a future route requires them, belong only in encrypted deployment secrets;
- merchant private keys are never accepted or stored;
- the one-time merchant activation verifies a wallet signature but does not authorize a token transfer.

## Routing and failover

Verification may use another compatible route only where that operation submits no value.

Settlement selects exactly one route before the outbound boundary. Once submission starts, XGuard never sends the same authorization to a second facilitator. Unknown outcome becomes ambiguous and requires independent finality/recovery evidence.

## Economic eligibility

A downstream route must not be enabled merely because it responds. Before production use it needs:

1. attributable provider identity and endpoint;
2. current protocol terms and cost evidence;
3. measured `/supported` compatibility;
4. bounded transport and strict response validation;
5. unit economics compatible with the XGuard signed merchant terms;
6. authorized mainnet settlement evidence, including duplicate/replay and timeout behavior;
7. independent chain-finality verification before XGuard can earn a seller fee;
8. recurring operational monitoring and rollback ownership.

If downstream cost rises above the protected economic threshold, the route should fail closed or pricing must be changed through a **new disclosed/signed merchant pricing version**. Existing signed merchant terms are not silently rewritten.

## Optional testnet

The separate Base Sepolia Worker is manual-only and non-billable. Testnet state remains isolated from mainnet merchant activation, service-fee balances and earned revenue.

## Legacy identifiers

Some historical internal identifiers may retain older provider or prepaid terminology for persistence compatibility. They do not change the live external route, the zero-friction x402 seller contract, or signer attribution.
