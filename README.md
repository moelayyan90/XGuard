# XGuard Universal Agent Transaction Control Plane

A protocol-neutral, non-custodial control layer for agent payments, commerce, MCP tools and machine-to-machine transactions.

**Production control plane:** https://api.xguardgate.com  
**Website:** https://xguardgate.com

## One control point above the protocols

XGuard no longer depends on a single payment standard. It can sit in-path for:

- x402
- MPP / Payment HTTP Authentication
- AP2 mandates
- UCP commerce traffic
- ACP checkout/order traffic
- MCP JSON-RPC tool calls
- Visa-style trusted-agent HTTP signatures
- generic HTTPS machine transactions

The existing x402 facilitator surface remains native:

- `GET /supported`
- `POST /verify`
- `POST /settle`

The protocol-neutral edge is:

```text
https://api.xguardgate.com/edge/<merchant-host>/<path>
```

A merchant authorizes its hostname without creating an XGuard account by publishing:

```dns
_xguard.<merchant-host> TXT "xguard-edge=enabled"
```

This prevents XGuard from becoming an open proxy: only hosts that explicitly opt in can be reached through the edge, and private/local network targets are blocked.

## What happens in-path

For every edge request XGuard:

1. detects the transaction protocol
2. derives the operation type (settlement, payment, checkout, tool call, mandate, read/write)
3. computes a deterministic request digest
4. applies protocol-aware policy checks
5. blocks clear binding failures before the origin
6. forwards the request to the merchant/API
7. meters only successful billable transaction calls
8. leaves reads and failed transactions uncharged

The x402 path additionally keeps multi-facilitator capability routing, failover, EIP-3009 checks, durable receipts and timeout reconciliation.

## Discovery

- universal protocol surface: https://api.xguardgate.com/v1/protocols
- machine-readable manifest: https://api.xguardgate.com/.well-known/xguard.json
- inspect a transaction without forwarding it: `POST https://api.xguardgate.com/v1/inspect`
- x402 capabilities: https://api.xguardgate.com/supported
- OpenAPI: https://api.xguardgate.com/openapi.json
- MCP: https://api.xguardgate.com/mcp
- Agent Card: https://api.xguardgate.com/.well-known/agent-card.json

## Drop-in edge adapter

`packages/edge` contains a protocol-neutral fetch adapter. It rewrites requests for an authorized merchant origin through the XGuard edge without changing application-level protocol code.

## Pricing

### Universal edge

- first 1,000 successful billable transactions per hostname: free
- then 1 XGuard Usage Credit per successful billable transaction
- GET/HEAD/OPTIONS: free
- failed transactions: free

### Native x402 settlement control plane

- `/verify`: free
- first 25 successful settlements per merchant: free
- then 2 XGuard Usage Credits per successful settlement
- failed settlements: free

Usage credits: https://lfsystems.lemonsqueezy.com/checkout/buy/f4c81819-1b10-4f1d-995d-46206a889dab

## Security posture

- no custody of buyer or merchant funds
- no merchant private keys
- no mutation of signed payment amounts or recipients
- private/local proxy targets are blocked
- merchant edge activation requires DNS ownership proof
- x402 requirement/accepted binding failures are fail-closed
