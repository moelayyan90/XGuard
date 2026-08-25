# XGuard Settlement Control Plane

A non-custodial universal facilitator control plane for production x402 servers.

**Production facilitator:** https://api.xguardgate.com  
**Website:** https://xguardgate.com  
**Standalone timeout reconciliation:** https://reconcile.xguardgate.com

## One facilitator URL

XGuard aggregates multiple production facilitators behind the standard x402 interface:

- `GET /supported`
- `POST /verify`
- `POST /settle`

Resource servers keep one facilitator URL while XGuard performs capability-aware routing, health failover, payment-context enforcement, durable receipts and Base timeout reconciliation.

## Official x402 SDK compatibility

The official x402 SDK already accepts any facilitator URL. Zero-package configuration:

```js
import { HTTPFacilitatorClient } from "@x402/core/server";

const facilitatorClient = new HTTPFacilitatorClient({
  url: "https://api.xguardgate.com",
});
```

Or install the XGuard adapter directly from GitHub:

```bash
npm install github:moelayyan90/XGuard#main
```

```js
import { createXGuardFacilitator } from "xguard-x402-control-plane";
const facilitatorClient = createXGuardFacilitator({
  licenseKey: process.env.XGUARD_LICENSE_KEY,
});
```

## What XGuard does

- aggregates supported payment kinds from multiple facilitators
- routes by network/capability and live upstream health
- failover between production facilitator providers
- validates requirement-to-payload bindings before upstream processing
- enforces recipient and amount binding
- direct Base polling after ambiguous settlement failures
- EIP-3009 authorization-state reconciliation
- durable idempotency receipts for confirmed settlements
- replayed settlement authorizations return the stored result instead of broadcasting again
- no custody, no merchant private keys, no change to signed amount or recipient

## Pricing

- `/verify`: free
- first 25 successful routed settlements per merchant: free
- after that: 2 XGuard Usage Credits per successful routed settlement
- failed settlements: no credits consumed
- no subscription

Usage credits: https://lfsystems.lemonsqueezy.com/checkout/buy/f4c81819-1b10-4f1d-995d-46206a889dab

## Settlement receipts

A confirmed settlement can include:

```http
X-XGuard-Receipt-Id: xgr_...
X-XGuard-Resolution: upstream | authorization_recovered | confirmed_late
```

Retrieve the durable receipt:

```http
GET https://api.xguardgate.com/v1/receipts/xgr_...
```

## Discovery

- capabilities: https://api.xguardgate.com/supported
- health: https://api.xguardgate.com/healthz
- OpenAPI: https://api.xguardgate.com/openapi.json
- MCP: https://api.xguardgate.com/mcp
- Agent Card: https://api.xguardgate.com/.well-known/agent-card.json
