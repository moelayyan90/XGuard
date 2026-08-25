# XGuard Universal Agent Transaction Control Plane

A protocol-neutral, non-custodial control layer for agent payments, commerce, MCP tools and machine-to-machine transactions.

**Free Agent Transaction Safety Test:** https://xguardgate.com/test  
**Safety Test API:** `POST https://api.xguardgate.com/v1/test`  
**ATS-100 specification:** `specs/ATS-100.md`  
**Production control plane:** https://api.xguardgate.com  
**Website:** https://xguardgate.com

## XGuard ATS-100

ATS-100 is the open 0–100 Agent Transaction Safety Score used by the free XGuard test. It scores the runtime controls that autonomous retries make critical: protocol clarity, idempotency, context binding, replay uniqueness, freshness and authorization/auditability.

Teams can use the web test once or make ATS-100 a **required CI gate** so unsafe agent transaction samples cannot merge.

```yaml
name: Agent transaction safety
on: [pull_request]
jobs:
  ats100:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: moelayyan90/XGuard@main
        with:
          sample: .xguard/transaction.json
          min-score: "90"
```

The included `.xguard/transaction.json` is a non-production example. Do not commit live card data, private keys, bearer secrets or payment credentials.

## Free Agent Transaction Safety Test

Before routing traffic through XGuard, a team can paste a **sample** agent transaction and receive an ATS-100 structural runtime-readiness score.

The free test checks:

- protocol identification across x402, MPP, AP2, UCP, ACP, MCP and signed/generic HTTPS
- mutation idempotency
- recipient/resource/amount or mandate context binding
- consume-once / replay uniqueness signals
- expiry and freshness windows
- request authorization and traceability

The merchant endpoint is **not contacted**. The report is a structural safety test, not a certification.

Example:

```bash
curl -X POST https://api.xguardgate.com/v1/test \
  -H 'content-type: application/json' \
  --data '{
    "target":"https://merchant.example/checkout",
    "method":"POST",
    "headers":{"Idempotency-Key":"demo-123","Request-Id":"req-demo"},
    "body":{"amount":"1000","transaction_id":"tx-demo","expires":"2026-08-26T00:00:00Z"}
  }'
```

The report ends with the shortest in-path fix using XGuard Edge when application-level retry/replay controls are incomplete.

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

- free web safety test: https://xguardgate.com/test
- safety test API: `POST https://api.xguardgate.com/v1/test`
- safety test schema: https://api.xguardgate.com/v1/test/schema
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

### Safety test

- web and API structural test: free
- GitHub Action safety gate: free

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
