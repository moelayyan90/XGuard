# XGuard production listing evidence

This document is a concise machine-verifiable evidence pack for production x402 directories and facilitator reviewers.

## Production service

- Mainnet origin: `https://xguardgate.com`
- Protocol: x402 v2
- Network: Base mainnet (`eip155:8453`)
- Asset: native Circle USDC
- Standard facilitator endpoints: `/supported`, `/verify`, `/settle`
- Provider manifest: `/.well-known/x402/facilitator.json`
- Readiness: `/readyz`
- Health: `/healthz`

## Differentiating safety contract

XGuard is a merchant-facing settlement truth and recovery layer around routed x402 settlement. It independently verifies finalized Base USDC evidence and exposes fail-closed settlement truth states:

- `FINALIZED`
- `PENDING`
- `PROVEN_FAILED`
- `CONFLICT`

Merchant-scoped endpoints:

- `GET /v1/settlements/{logicalPaymentKey}/truth`
- `POST /v1/settlements/{logicalPaymentKey}/resolve`

A payment is advertised as release-safe only after independent finality evidence is sufficient.

## Commercial model

XGuard charges the merchant service balance only for a successful billable settlement that reaches the earned state. The current service fee is `$0.002` per successful billable settlement. Failed, rejected, duplicate/replayed, testnet, or unresolved ambiguous attempts do not become earned XGuard revenue.

## Public source and verification

- Source: `https://github.com/moelayyan90/XGuard`
- Live machine-readable provider metadata: `https://xguardgate.com/.well-known/x402/facilitator.json`
- Live protocol capabilities: `https://xguardgate.com/supported`
- Live readiness: `https://xguardgate.com/readyz`
- Live status: `https://xguardgate.com/status`

This evidence pack intentionally makes no claim that XGuard is part of the x402 protocol standard or endorsed by the x402 Foundation. It exists so directory maintainers can independently evaluate the live service.
