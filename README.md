# XGuard Settlement Control Plane

**One facilitator URL between every x402 payment and the chain.**

XGuard is a non-custodial, in-path payment firewall and reliability control plane for production x402 v2 servers. Once a resource server uses `https://api.xguardgate.com` as its facilitator URL, every `/verify` and `/settle` request passes through XGuard before an upstream facilitator.

**Production:** https://api.xguardgate.com  
**Website:** https://xguardgate.com  
**Paid timeout reconciliation:** https://reconcile.xguardgate.com  
**Remote MCP:** https://api.xguardgate.com/mcp

## Why put XGuard in the payment path?

Before settlement XGuard binds the payment requirements to the accepted payload and fails closed on material mismatches:

- scheme
- network
- asset
- recipient (`payTo`)
- amount

For canonical Base USDC exact payments it also validates EIP-3009 authorization invariants before forwarding:

- authorization recipient matches the merchant recipient
- authorization value matches the required amount
- nonce is structurally valid
- authorization time window is valid

After the firewall passes, XGuard provides:

- health-aware multi-facilitator routing
- automatic facilitator failover
- durable settlement receipts
- replay/idempotency protection
- Base polling after ambiguous settlement errors
- EIP-3009 authorization-state reconciliation before declaring failure
- recovery of late-confirmed settlements
- no custody and no private keys

## Drop-in integration

Use XGuard as the facilitator URL in an x402 resource server:

```text
https://api.xguardgate.com
```

Standard facilitator surface:

```text
GET  /supported
POST /verify
POST /settle
```

Machine discovery:

```text
GET  /.well-known/x402.json
GET  /.well-known/agent-card.json
GET  /openapi.json
GET  /skill.md
POST /mcp
```

A confirmed settlement can include:

```http
X-XGuard-Receipt-Id: xgr_...
X-XGuard-Resolution: upstream | authorization_recovered | confirmed_late
X-XGuard-Firewall: pass
```

Read a durable receipt:

```http
GET https://api.xguardgate.com/v1/receipts/xgr_...
```

## Pricing

- `/verify`: free
- first 25 successful routed settlements per merchant: free
- after that: 2 XGuard Usage Credits per successful routed settlement
- failed settlements: no credits consumed
- standalone reconciliation endpoint: `$0.002 USDC` per successful x402 call
- no subscription required

Usage credits: https://lfsystems.lemonsqueezy.com/checkout/buy/f4c81819-1b10-4f1d-995d-46206a889dab

## Discovery

XGuard publishes OpenAPI, x402 well-known metadata, an A2A-compatible agent card, `skill.md`, `llms.txt`, and a remote MCP server. The remote MCP server is published under:

```text
io.github.moelayyan90/xguard-control-plane
```

The paid reconciliation resource publishes Bazaar metadata in its HTTP 402 challenge for agent-native discovery.

## Security model

XGuard is deliberately non-custodial. It does not hold buyer or merchant private keys and does not replace the merchant's signed recipient or amount. It sits in the verification/settlement request path and rejects inconsistent payment context before delegation to an upstream facilitator.
