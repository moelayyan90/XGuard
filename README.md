# XGuard Payment Layer

[![CI](https://github.com/moelayyan90/XGuard/actions/workflows/ci.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/ci.yml)
[![CodeQL](https://github.com/moelayyan90/XGuard/actions/workflows/codeql.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/codeql.yml)
[![Mainnet](https://github.com/moelayyan90/XGuard/actions/workflows/deploy-mainnet.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/deploy-mainnet.yml)

**XGuard is a payment-control layer that is meant to sit beside the payment, not force the payer into another XGuard website.**

The primary buyer-side product is a Chromium browser layer that can run on normal HTTPS checkout, billing, beneficiary, payment and transfer surfaces. It can appear beside a detected native payment/transfer action and give the payer a persistent payment memory and control surface without requiring the merchant to integrate XGuard.

The browser layer currently supports:

- **ترحيل لغايات الدفع / Defer for payment** — capture a payment into the local queue while already on its real payment surface;
- **دفع هذه فقط / Pay this only** — start one selected tracked payment;
- **دفع كل الفواتير / Pay all bills** — coordinate a sequence of deferred payments;
- **saved payees** — remember recipients and reuse their last known payment destination instead of rebuilding the same recipient every time;
- **payment history** — keep a local record of completed payment sessions;
- **تقسيم الفواتير / Split bills** — create child payments across saved payees;
- optional XGuard verification and payment-safety services.

The queue, remembered payees and history are stored locally by the browser layer. Merchant participation is not required for these buyer-side controls. XGuard does not request full card PAN, CVV/CVC, PIN, online-banking passwords, wallet private keys, seed phrases or mnemonics.

## The product boundary is not x402

XGuard also exposes protocol and software integration surfaces, but they are **adapters around the payment layer**, not the definition of the product.

Current surfaces include:

- browser payment-surface layer;
- HTTP and OpenAPI;
- MCP;
- A2A;
- webhooks and generic protocol connectors;
- x402 v2 settlement safety, truth and recovery.

x402 remains an important adapter for compatible resource servers. It is not a requirement for the browser Payment Layer and should not be interpreted as the only market XGuard serves.

## Live public surfaces

- **Website:** `https://xguardgate.com`
- **Install:** `https://xguardgate.com/install`
- **Payment Layer manifest:** `https://xguardgate.com/.well-known/xguard/payment-layer.json`
- **Protocol adapter registry:** `https://xguardgate.com/.well-known/xguard/protocols.json`
- **OpenAPI:** `https://xguardgate.com/openapi.json`
- **Remote MCP:** `https://xguardgate.com/mcp`
- **x402 adapter:** `https://xguardgate.com/.well-known/x402/facilitator.json`
- **Status:** `https://xguardgate.com/status`

## Browser Payment Layer

The store-ready extension source lives in [`browser-extension/`](browser-extension/).

The current manifest is **XGuard Payment Layer 0.2.1** and activates both:

```text
universal-layer.js
surface-rail.js
```

on:

```text
https://*/*
```

The inline rail is designed to appear beside a detected native payment or transfer action. The full layer holds deferred bills, saved payees, active payment sessions and local history.

### Public early-access package

The repository publishes a persistent public GitHub Release for the current browser runtime:

```text
https://github.com/moelayyan90/XGuard/releases/download/xguard-payment-layer-v0.2.1/xguard-payment-layer-0.2.1.zip
```

The browser-store submission kit and disclosure text are maintained in [`browser-extension/STORE_SUBMISSION.md`](browser-extension/STORE_SUBMISSION.md). The project does not claim a Chrome Web Store or Edge Add-ons listing until one has actually been published.

## What XGuard does not pretend to do

The buyer-side browser layer can coordinate multiple payment intentions, but unrelated merchant card or bank payments do not magically become one native debit. Each underlying merchant, bank, wallet or payment provider still owns its real authentication and execution rail. A true one-debit/many-recipient settlement mode requires an authorized underlying rail that supports batch authorization and distribution.

That distinction is intentional: XGuard owns the **control, memory, coordination, policy and safety layer** while the authorized payment provider continues to execute the actual money movement.

## Merchant and agent integrations

For software that wants XGuard in the execution path, the hosted service exposes payment-decision, discovery, gateway and protocol integration surfaces. These include OpenAPI, MCP, A2A, HTTP/webhook connectors and the x402 adapter.

Machine-readable universal product metadata is available at:

```text
GET /.well-known/xguard/payment-layer.json
```

Protocol-specific adapters are enumerated separately at:

```text
GET /.well-known/xguard/protocols.json
```

This separation is deliberate: **The Payment Layer is the product; protocols are ways to connect it.**

## x402 adapter: settlement safety and recovery

For x402 v2 resource servers, XGuard can operate as a hosted settlement-safety gateway around a downstream facilitator and independently track settlement truth.

The x402 path includes:

- replay and duplicate protection;
- one-settlement ownership under concurrency;
- finalized Base USDC verification;
- EIP-3009 ambiguity recovery;
- settlement truth states such as `FINALIZED`, `PENDING`, `PROVEN_FAILED` and `CONFLICT`;
- facilitator health and route controls;
- merchant accounting and reconciliation boundaries.

Merchant-scoped settlement truth is available through:

```text
GET  /v1/settlements/{logicalPaymentKey}/truth
POST /v1/settlements/{logicalPaymentKey}/resolve
```

The x402 integration currently targets Base mainnet native USDC with the exact/EIP-3009 authorization scheme. That restriction belongs to the **x402 adapter**, not to the buyer-side Payment Layer. For protocol-specific facilitator behavior and route details, see [facilitators](docs/FACILITATORS.md).

## Developer installation

The CLI, SDK and core packages are also published as CI-built GitHub release tarballs while first npm publication remains identity-gated.

```bash
npm install -g https://github.com/moelayyan90/XGuard/releases/download/xguard-packages-v0.1.0-alpha.1/xguard-0.1.0-alpha.0.tgz
xguard --help
```

The hosted x402 adapter can also be used through the standard x402 facilitator client. See [QUICKSTART.md](QUICKSTART.md) and [docs/API.md](docs/API.md).

## Discovery

XGuard exposes both human and machine discovery surfaces:

```text
GET /.well-known/xguard/payment-layer.json
GET /.well-known/xguard/protocols.json
GET /.well-known/mcp/server.json
GET /.well-known/agent-card.json
GET /.well-known/agent-market.json
GET /openapi.json
GET /llms.txt
GET /llms-full.txt
GET /discovery/resources
GET /discovery/search?query=...
POST /mcp
```

The discovery surfaces should describe protocol-specific capabilities without collapsing the whole XGuard product into one protocol.

### Remote MCP tools

The public Streamable HTTP MCP endpoint currently exposes the same five tools described by `lhm.plugin.json`:

- `xguard_payment_offer` — return a free pre-payment XGuard offer without executing or charging the underlying payment;
- `xguard_payment_decision` — evaluate a declared payment intent and return an `ALLOW`, `REVIEW`, or `BLOCK` decision with idempotent evidence, without executing the payment itself;
- `xguard_discover` — search or list XGuard x402 HTTP and MCP resources;
- `xguard_resource_details` — inspect one exact catalog resource by URL or key;
- `xguard_status` — return live gateway, payment-decision, and discovery status.

The payment-decision tools require declared payment metadata only; callers must not send card credentials, online-banking passwords, wallet private keys, seed phrases, or mnemonics.

## Security and operations

- [Security policy](SECURITY.md)
- [Threat model](THREAT_MODEL.md)
- [Architecture](ARCHITECTURE.md)
- [Incident response](INCIDENT_RESPONSE.md)
- [Operations](OPERATIONS.md)
- [Reconciliation](RECONCILIATION.md)
- [Browser privacy disclosure](browser-extension/PRIVACY.md)

Local verification:

```bash
npm run check
npm run verify:release
npm run smoke:live
npm run smoke:mainnet
```

## Documentation

[Quickstart](QUICKSTART.md) · [API](docs/API.md) · [facilitators](docs/FACILITATORS.md) · [OpenAPI](docs/openapi.yaml) · [Pricing](PRICING.md) · [Billing](BILLING.md) · [Deployment](DEPLOYMENT.md) · [Browser Store Submission](browser-extension/STORE_SUBMISSION.md)

XGuard is an independent project and is not an official product of the x402 Foundation, Coinbase, Cloudflare, Base, Circle, xpay, PayAI, OKX, Google or Microsoft.

Apache-2.0. See [CONTRIBUTING.md](CONTRIBUTING.md).
