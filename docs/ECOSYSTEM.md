# XGuard ecosystem listing metadata

This page is the canonical copy for ecosystem directories, developer-tool catalogs, agent registries, payment infrastructure catalogs, and integration curators.

## Product boundary

**XGuard** is a protocol-agnostic transaction safety, decision, evidence, and execution edge for AI agents, payment systems, APIs, and webhook workflows. It is not defined by x402: x402 remains one native settlement adapter in the wider XGuard runtime.

XGuard currently exposes three distinct public capability families:

1. **Buyer/agent pre-payment decision** — an optional free offer followed, only after opt-in, by an auditable `ALLOW`, `REVIEW`, or `BLOCK` decision and durable transaction-evidence record. The decision surface never executes the underlying purchase.
2. **Universal protocol/API edge** — routes and normalizes heterogeneous transaction/execution surfaces including x402, AP2, ACP, Visa Trusted Agent Protocol, MCP, A2A, HTTP/OpenAPI, GraphQL, JSON-RPC, and webhooks.
3. **Independent x402 settlement truth and recovery** — merchant-facing replay protection, one-settlement ownership, downstream routing, finalized Base USDC verification, ambiguity recovery, accounting, and reconciliation around x402 settlement.

## Canonical metadata

- **Name:** XGuard
- **Repository:** https://github.com/moelayyan90/XGuard
- **Production domain:** https://xguardgate.com
- **Remote MCP:** https://xguardgate.com/mcp
- **A2A endpoint:** https://xguardgate.com/a2a
- **Agent Card:** https://xguardgate.com/.well-known/agent-card.json
- **MCP metadata:** https://xguardgate.com/.well-known/mcp/server.json
- **OpenAPI:** https://xguardgate.com/openapi.json
- **Agent documentation:** https://xguardgate.com/llms.txt
- **Universal protocol registry:** https://xguardgate.com/.well-known/xguard/protocols.json
- **Security evidence metadata:** https://xguardgate.com/.well-known/xguard-security-evidence.json
- **License:** Apache-2.0

## Buyer / agent payment-decision surface

- **Free offer:** `POST /v1/payment/offer`
- **Opted-in decision:** `POST /v1/payment/decision`
- **Retrieve evidence record:** `GET /v1/payment/records/{decisionId}`
- **Append final payment outcome:** `POST /v1/payment/records/{decisionId}/settlement`
- **MCP tools:** `xguard_payment_offer`, `xguard_payment_decision`

The decision consumes declared transaction facts such as amount, currency, payee, provider, rail, origin/network context, expected amount/payee, expiry, and payment references. It rejects raw card/PAN/CVV/CVC/PIN fields, private keys, seed phrases, and mnemonics. `ALLOW` is not a claim of merchant reputation, solvency, card-network authorization, or fraud impossibility; results include explicit checks and reason codes.

## Universal edge

The universal mainnet edge supports protocol-aware routing and generic execution surfaces without making x402 the architectural root. Public discovery describes coverage for:

- x402
- AP2
- ACP
- Visa Trusted Agent Protocol
- MCP
- A2A
- HTTP / OpenAPI
- GraphQL
- JSON-RPC
- webhooks

Universal webhook ingress records bounded immutable event evidence and forwards the original payload to a merchant-controlled public HTTPS destination without storing the raw webhook body. Provider labeling is intentionally open rather than a fixed allowlist, so webhook-capable payment/SaaS systems can be represented without changing the XGuard core.

## x402 adapter metadata

- **Protocol:** x402 v2
- **Mainnet network:** Base (`eip155:8453`)
- **Asset:** native USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- **Scheme:** `exact`
- **Transfer flow:** EIP-3009 authorization
- **Facilitator-compatible methods:** `GET /supported`, `POST /verify`, `POST /settle`
- **Independent settlement truth:** `GET /v1/settlements/{logicalPaymentKey}/truth`
- **Immediate resolver:** `POST /v1/settlements/{logicalPaymentKey}/resolve`
- **Successful finalized x402 settlement fee:** `$0.002`
- **Subscription:** none
- **Current downstream production route:** xpay

### x402 attribution boundary

XGuard is the merchant-facing safety/routing/truth layer. It is **not represented as the direct on-chain settlement signer** when a downstream facilitator submits the transaction. The current production route uses xpay for downstream submission. Directories that classify facilitators exclusively by the transaction-submitting on-chain address should attribute that signer to xpay and list XGuard separately as routing/safety/evidence infrastructure where possible.

## Security and reliability highlights

- request-id idempotency and duplicate-fee prevention;
- replay and Payment Identifier protection on the x402 adapter;
- durable single-owner x402 settlement coordination;
- fail-closed ambiguity handling after settlement submission begins;
- independent finalized Base USDC evidence for x402 settlement truth;
- explicit `ALLOW` / `REVIEW` / `BLOCK` payment-decision semantics with reason codes;
- bounded request bodies and rejection of payment-secret-shaped fields on Payment Decision;
- public-HTTPS-only generic outbound targets, SSRF protections, and no redirect following;
- 256-bit universal webhook route tokens stored only as SHA-256 digests;
- immutable billing/evidence records and idempotency boundaries;
- CI, CodeQL, guarded production deployment, and commit-bound payment-security evidence.

## Directory-specific copy

### General / AI-agent directory

> **XGuard** — Universal transaction safety and evidence edge for AI agents. Agents can optionally request an auditable pre-payment `ALLOW`, `REVIEW`, or `BLOCK` decision before spending money, while XGuard also exposes A2A/MCP discovery, protocol-aware API/webhook execution, and independent x402 settlement truth. Production: https://xguardgate.com

### MCP directory

> **XGuard** — Remote MCP server for optional buyer/agent pre-payment decisions and durable evidence, plus paid-resource discovery and x402 settlement tooling. The offer is free; opted-in decision execution is idempotent and never executes the underlying purchase. MCP: https://xguardgate.com/mcp

### A2A directory

> **XGuard** — A2A-accessible transaction safety/evidence service for autonomous agents, including optional pre-payment decision support and machine-readable discovery. Agent Card: https://xguardgate.com/.well-known/agent-card.json

### Payment infrastructure / x402 directory

> **XGuard** — Independent x402 settlement truth, recovery, replay-protection, and routing layer for Base USDC, operating through a facilitator-compatible API while preserving downstream signer attribution. `$0.002` per successful finalized billable x402 settlement; no subscription.

## Independence

XGuard is an independent project and is not described as an official product or endorsed service of the x402 Foundation, Coinbase, Cloudflare, Base, Circle, xpay, Visa, Google, OpenAI, Anthropic, or any registry unless that status is explicitly granted and independently verifiable.
