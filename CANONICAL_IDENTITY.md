# XGuard canonical product identity

**Current canonical identity:** XGuard Universal Paid AI Agent + Secretless Gateway

**Current version:** 5.1.0

**Primary product:** Universal Paid AI Agent + Secretless Gateway

**Canonical website:** https://xguardgate.com

**Canonical API:** https://api.xguardgate.com

**Canonical remote MCP:** https://api.xguardgate.com/mcp
**Official MCP Registry name:** `io.github.moelayyan90/xguard-control-plane`

## What XGuard is now

XGuard is paid-tool and credential infrastructure for AI agents. Any agent can discover actual capabilities, obtain a signed input-bound price, pay per request using x402 v2 USDC, and receive controlled execution with a signed receipt and ProofRail evidence. No XGuard account or subscription is required for this path. Payment-Identifier and durable replay state make an exact retry return the original outcome without another settlement.

For credential-backed APIs, an operator can also keep reusable upstream credentials in XGuard and give an agent a short-lived scoped capability instead of the reusable secret. XGuard injects that credential only at controlled egress and never returns it to the agent.

ProofRail is the signed execution-evidence layer for successful settled paid tools and authorized Secretless Egress outcomes.

## Supported execution rails

The x402 paid-tool path and Secretless Egress are the canonical product. Action Rail, facilitator relay/routing endpoints, and the operator Usage Credit path remain supported secondary surfaces.

## Historical descriptions that are not current

Do **not** describe the current XGuard product as any of the following:

- XGuard ACE.
- A Solana/BAM deterministic speed-bump product.
- A 10–50 ms toxic-flow or stale-quote scheduler.
- A Child Safety platform.
- A Web Extractor product.
- XGuard Universal Facilitator Gateway.
- XGuard High-Velocity x402 Facilitator as the overall product.
- A generic spend-only or universal transaction control plane as the overall product.

Some source files retain compatibility implementations and historical internal modules so existing protocol paths can continue to work. Their names and comments do not override this canonical product identity.

## Source-of-truth priority

When descriptions conflict, use this order:

1. `https://xguardgate.com/identity`
2. `https://xguardgate.com/llms.txt`
3. `https://xguardgate.com/server.json`
4. `https://api.xguardgate.com/openapi.json`
5. This file and the repository README

The production edge also adds canonical identity headers and normalizes public discovery metadata so compatibility modules cannot overwrite the public product identity.
