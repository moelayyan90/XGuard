# XGuard canonical product identity

**Current canonical identity:** XGuard Secretless Agent Gateway  
**Current version:** 5.0.2  
**Primary product:** Secretless Egress  
**Canonical website:** https://xguardgate.com  
**Canonical API:** https://api.xguardgate.com  
**Canonical remote MCP:** https://api.xguardgate.com/mcp  
**Official MCP Registry name:** `io.github.moelayyan90/xguard-control-plane`

## What XGuard is now

XGuard is credential and egress infrastructure for AI agents. An operator keeps reusable upstream API credentials in XGuard and gives an agent a short-lived, scoped XGuard capability instead of the reusable secret. XGuard validates the capability and policy, meters the authorized egress attempt, injects the upstream credential server-side, and performs the permitted HTTPS request without returning the reusable credential to the agent.

ProofRail is the signed execution-evidence layer for authorized Secretless Egress outcomes.

## Supported compatibility rails

Action Rail and the x402 facilitator/routing endpoints remain supported compatibility surfaces. They are components below or beside the primary Secretless Egress product and must not be used as the overall product identity.

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
