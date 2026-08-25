# XGuard x402 facilitator client

Drop-in production facilitator configuration for the official x402 TypeScript SDK.

## Install directly from GitHub

```bash
npm install github:moelayyan90/XGuard#main
```

The official x402 packages remain the protocol implementation. XGuard only replaces the facilitator URL/control plane.

## Express / Hono / Next / Fastify

```js
import { createXGuardFacilitator } from "xguard-x402-control-plane";

const facilitatorClient = createXGuardFacilitator({
  licenseKey: process.env.XGUARD_LICENSE_KEY,
});
```

Use `facilitatorClient` anywhere the official x402 SDK expects a `FacilitatorClient` / `HTTPFacilitatorClient`.

Without a license key, `/verify` remains free and successful `/settle` calls use the merchant free allowance. After the allowance, a license with XGuard Usage Credits is required.

## Zero-package configuration

No adapter is required if the application already constructs the official client:

```js
import { HTTPFacilitatorClient } from "@x402/core/server";

const facilitatorClient = new HTTPFacilitatorClient({
  url: "https://api.xguardgate.com",
  createAuthHeaders: async () => ({
    verify: {},
    supported: {},
    settle: process.env.XGUARD_LICENSE_KEY
      ? { Authorization: `Bearer ${process.env.XGUARD_LICENSE_KEY}` }
      : {},
  }),
});
```

## What the control plane adds

- one facilitator URL across aggregated upstream capabilities
- capability-aware health routing
- payment context firewall before upstream verification/settlement
- recipient and amount binding
- durable replay-safe settlement receipts
- Base USDC EIP-3009 timeout reconciliation
- failover between production facilitator providers
- no custody and no merchant private keys

Live capability discovery: `https://api.xguardgate.com/supported`

Health: `https://api.xguardgate.com/healthz`
