# XGuard canonical product identity

**Current canonical identity:** XGuard — Agent Execution Gateway

**Candidate version:** 5.2.0 (verify the deployed identity before claiming it is live)

**Primary product:** Agent Execution Gateway

**Canonical website:** https://xguardgate.com

**Canonical API:** https://api.xguardgate.com

**Canonical remote MCP:** https://api.xguardgate.com/mcp
**Official MCP Registry name:** `io.github.moelayyan90/xguard-control-plane`

## What XGuard is now

Give agents capabilities, not reusable credentials.

XGuard is an execution gateway. An operator keeps reusable provider credentials
server-side and delegates short-lived capabilities for explicit operations and
resources. The gateway enforces policy and budgets, reserves idempotency, commits
billing, injects credentials at egress and returns durable signed evidence.

Public paid outcomes are working secondary examples. They preserve signed prices,
x402 USDC settlement before execution and durable recovery. Demo, canary, testnet,
probe and self-payment activity must not be represented as customer revenue.

ProofRail is the signed execution-evidence layer for successful settled paid tools and authorized Secretless Egress outcomes.

## Supported execution rails

Capability-backed Secretless execution is the primary path. The x402 paid-tool path remains supported. Action Rail, facilitator relay/routing endpoints, and the operator Usage Credit path remain supported secondary surfaces.

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
