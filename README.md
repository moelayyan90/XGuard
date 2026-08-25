# XGuard — Agent Spend Firewall + Universal Transaction Control Plane

A protocol-neutral, non-custodial control layer for autonomous payments, commerce, MCP tools and machine-to-machine transactions.

**Create scoped spend mandates:** `POST https://api.xguardgate.com/v1/mandates`  
**Free ATS-100 safety test:** https://xguardgate.com/test  
**Production control plane:** https://api.xguardgate.com

## The problem XGuard makes non-optional

An autonomous agent that can spend money or trigger paid actions needs deterministic authority: **who authorized it, how much may it spend, with which merchant, how often, and until when?**

XGuard puts that decision in-path.

For financial actions through XGuard Edge, a valid **XGuard Mandate is mandatory**. The mandate can enforce:

- agent identity
- merchant allowlist
- action allowlist
- maximum amount per transaction
- daily authorization ceiling
- maximum uses
- expiry
- immediate revocation

Requests outside the mandate are rejected before the merchant origin is reached.

Required headers for financial edge actions:

```text
X-XGuard-Mandate: xgm_...
X-XGuard-Amount-Minor: 2500
X-XGuard-Currency: USD
```

Create a mandate with a valid XGuard Usage Credits license:

```bash
curl -X POST https://api.xguardgate.com/v1/mandates \
  -H 'Authorization: Bearer <XGUARD_LICENSE_KEY>' \
  -H 'Content-Type: application/json' \
  --data '{
    "agent_id":"procurement-agent-7",
    "currency":"USD",
    "max_amount_minor":"5000",
    "daily_limit_minor":"25000",
    "max_uses":20,
    "allowed_merchants":["merchant.example"],
    "allowed_actions":["checkout","payment","order"],
    "ttl_seconds":86400
  }'
```

Machine-readable authority discovery:

```text
https://api.xguardgate.com/.well-known/xguard-authority.json
```

## ATS-100 — free acquisition and CI gate

ATS-100 is the open 0–100 Agent Transaction Safety Score. It checks protocol clarity, idempotency, context binding, replay uniqueness, freshness and authorization/auditability without contacting the target merchant.

Teams can use the web test or make ATS-100 a required pull-request gate:

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

Do not put live card data, private keys, bearer secrets or production payment credentials in ATS-100 samples.

## One control point above the protocols

XGuard recognizes:

- x402
- MPP / Payment HTTP Authentication
- AP2 mandates
- UCP commerce traffic
- ACP checkout/order traffic
- MCP JSON-RPC tool calls
- signed trusted-agent HTTP
- generic HTTPS machine transactions

The native x402 facilitator surface remains:

- `GET /supported`
- `POST /verify`
- `POST /settle`

The protocol-neutral edge is:

```text
https://api.xguardgate.com/edge/<merchant-host>/<path>
```

A merchant authorizes its hostname by publishing:

```dns
_xguard.<merchant-host> TXT "xguard-edge=enabled"
```

Private/local targets are blocked, so XGuard Edge cannot be used as an open proxy.

## What happens in-path

For an agent-facing edge request XGuard:

1. detects the transaction protocol
2. derives the operation type
3. requires a scoped XGuard Mandate for financial actions
4. atomically enforces merchant/action/amount/daily-limit/expiry/revocation rules
5. derives a deterministic request digest
6. blocks unsafe targets and clear binding failures
7. forwards allowed requests to the merchant/API
8. meters only successful billable transaction calls

The native x402 path additionally keeps multi-facilitator routing, failover, EIP-3009 checks, durable receipts and timeout reconciliation.

## Discovery

- spend authority: https://api.xguardgate.com/.well-known/xguard-authority.json
- create mandate: `POST https://api.xguardgate.com/v1/mandates`
- mandate status: `GET https://api.xguardgate.com/v1/mandates/status`
- revoke mandate: `POST https://api.xguardgate.com/v1/mandates/revoke`
- ATS-100 web test: https://xguardgate.com/test
- ATS-100 API: `POST https://api.xguardgate.com/v1/test`
- protocol surface: https://api.xguardgate.com/v1/protocols
- OpenAPI: https://api.xguardgate.com/openapi.json
- MCP: https://api.xguardgate.com/mcp
- Agent Card: https://api.xguardgate.com/.well-known/agent-card.json

## Pricing

### ATS-100

Free.

### XGuard Edge

- first 1,000 successful billable transactions per hostname: free
- then 1 XGuard Usage Credit per successful billable transaction
- reads and failed transactions: free

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
- scoped spend mandates with immediate revocation
- private/local proxy targets blocked
- merchant edge activation requires DNS ownership proof
- x402 requirement/accepted binding failures fail closed
