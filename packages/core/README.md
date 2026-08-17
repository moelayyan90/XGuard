# @xguard/core

Strict x402 v2 validation, health/cost-aware routing, settlement replay protection, explicit ambiguity handling, exact micro-USD accounting, reconciliation, and payout-policy primitives.

These primitives back XGuard's production gateway on Base mainnet (`eip155:8453`) and its `exact` EVM settlement-safety path. The library itself does not deploy a gateway, hold merchant credentials, create funding, or initiate payments on its own; production execution remains controlled by the hosted XGuard gateway and its authenticated mainnet flow.

Testnet remains available for explicit non-billable testing, but it is not the default environment for XGuard production integration.
