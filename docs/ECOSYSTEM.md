# XGuard ecosystem listing metadata

This page is the canonical copy for ecosystem directories, developer-tool catalogs, and integration curators.

## Short listing

**XGuard** — Hosted x402 v2 safety and routing gateway for Base mainnet. Provides a facilitator-compatible `/supported`, `/verify`, and `/settle` surface with replay protection, duplicate-settlement protection, settlement ownership, health-aware routing, independent USDC finality verification, accounting, reconciliation, and observability. No XGuard package installation is required. `$0.002` per successful billable settlement; no subscription.

## Canonical metadata

- **Name:** XGuard
- **Category:** x402 infrastructure / hosted safety & routing gateway / facilitator-compatible middleware
- **Repository:** https://github.com/moelayyan90/XGuard
- **Live mainnet endpoint:** https://xguard-mainnet.maqamapp.workers.dev
- **Testnet endpoint:** https://xguard-testnet.maqamapp.workers.dev
- **Protocol:** x402 v2
- **Mainnet network:** Base (`eip155:8453`)
- **Asset:** native USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- **Scheme:** `exact`
- **Transfer flow:** EIP-3009 authorization
- **Public facilitator-compatible methods:** `GET /supported`, `POST /verify`, `POST /settle`
- **Price:** `$0.002` per successful billable settlement
- **Subscription:** none
- **Current downstream production route:** xpay
- **Current configured downstream facilitator fee:** `$0`
- **License:** Apache-2.0

## Classification note

XGuard is the merchant-facing hosted safety/routing gateway. It is **not represented as the direct on-chain settlement signer** when a downstream facilitator submits the transaction. The current production route uses xpay for downstream submission. Directories that classify facilitators exclusively by the transaction-submitting on-chain address should therefore classify the settlement as xpay and list XGuard separately as routing/safety infrastructure where possible.

## Security / reliability highlights

- replay and Payment Identifier protection;
- idempotent duplicate-settlement handling;
- durable single-owner settlement coordination;
- fail-closed ambiguity handling after submission begins;
- health-aware route state and circuit controls;
- independent finalized Base USDC transfer verification;
- merchant service-balance accounting and immutable usage events;
- reconciliation tracking;
- Cloudflare rate limiting, concurrency controls, strict request parsing, capped bodies, and structured observability;
- CI, CodeQL, guarded production deployment, and live Mainnet readiness monitoring.

## Integration

Existing x402 v2 resource servers can use the standard `HTTPFacilitatorClient` and point it at:

```text
https://xguard-mainnet.maqamapp.workers.dev
```

Mainnet requests require an XGuard merchant API key and sufficient prepaid XGuard service balance. Full onboarding is documented in the repository Quickstart.

## Suggested directory copy

> **XGuard** — Hosted x402 v2 safety/routing gateway for Base USDC. Adds replay and duplicate-settlement protection, durable settlement coordination, health-aware routing, independent finality checks, accounting and reconciliation around a facilitator-compatible API. No XGuard package installation required. $0.002 per successful billable settlement, no subscription.

## Independence

XGuard is an independent project and is not an official product of the x402 Foundation, Coinbase, Cloudflare, Base, Circle, xpay, or OKX.
