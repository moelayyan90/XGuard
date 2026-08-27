# XGuard x402 facilitator client

Drop-in production facilitator configuration for the official x402 v2 TypeScript SDK.

Canonical facilitator:

```text
https://api.xguardgate.com
```

## Install

Until an npm publication is independently verified, install the tested package directly from GitHub:

```bash
npm install github:moelayyan90/XGuard#main
```

The x402 packages remain the protocol implementation. XGuard replaces the facilitator/control-plane endpoint used for `/supported`, `/verify`, and `/settle`.

## One-import facilitator

```js
import { facilitator } from "xguard-x402-control-plane";
```

Use `facilitator` anywhere the official x402 server middleware accepts an `HTTPFacilitatorClient`.

The zero-configuration export uses XGuard's free verification and current free settlement allowance. Merchants with XGuard Usage Credits should construct an authenticated client:

```js
import { createXGuardFacilitator } from "xguard-x402-control-plane";

const facilitator = createXGuardFacilitator({
  licenseKey: process.env.XGUARD_LICENSE_KEY,
});
```

## Resource-server shortcut

```js
import { createXGuardResourceServer } from "xguard-x402-control-plane";
import { registerExactEvmScheme } from "@x402/evm/exact/server";

const server = createXGuardResourceServer({
  licenseKey: process.env.XGUARD_LICENSE_KEY,
});
registerExactEvmScheme(server);
```

Then pass `server` into the official x402 middleware for your framework.

## Complete examples

The package ships copyable examples using the current x402 v2 APIs:

- `sdk/examples/express.mjs`
- `sdk/examples/hono.mjs`
- `sdk/examples/next-middleware.mjs`
- `sdk/examples/mcp-paid-tool.mjs`
- `integrations/python/fastapi_xguard.py`
- `integrations/go/gin_xguard.go`

All examples point the resource server at XGuard, so payment verification and settlement enter XGuard's money path.

## Discovery and routing helpers

```js
import {
  xguardSupported,
  xguardFacilitator,
  xguardRoute,
  xguardDiscoveryResources,
  xguardDiscoverySearch,
} from "xguard-x402-control-plane";

const supported = await xguardSupported();
const provider = await xguardFacilitator();
const route = await xguardRoute({ network: "eip155:8453", scheme: "exact" });
const resources = await xguardDiscoveryResources({ network: "eip155:8453", limit: 20 });
const search = await xguardDiscoverySearch("market data");
```

## Zero-package configuration

If an application already constructs the official x402 client, no XGuard package is required:

```js
import { HTTPFacilitatorClient } from "@x402/core/server";

const facilitator = new HTTPFacilitatorClient({
  url: "https://api.xguardgate.com",
  createAuthHeaders: async () => ({
    supported: {},
    verify: {},
    settle: process.env.XGUARD_LICENSE_KEY
      ? { Authorization: `Bearer ${process.env.XGUARD_LICENSE_KEY}` }
      : {},
  }),
});
```

## Settlement-safety behavior

XGuard does not blindly retry a signed settlement across upstream facilitators.

- verification can fail over on retryable upstream failures because verification does not spend the payment;
- explicit rate limiting may move to another compatible route;
- Base USDC ambiguous settlement responses are reconciled against EIP-3009 authorization state before any retry;
- on networks without a reliable reconciliation proof, an ambiguous timeout/5xx fails closed instead of forwarding the same signed payment to another facilitator;
- successful settlement receipts are stored durably for replay-safe lookup.

## Public endpoints

```text
GET  https://api.xguardgate.com/supported
POST https://api.xguardgate.com/verify
POST https://api.xguardgate.com/settle
GET  https://api.xguardgate.com/facilitator
GET  https://api.xguardgate.com/discovery/resources
GET  https://api.xguardgate.com/discovery/search?query=...
GET  https://api.xguardgate.com/v1/facilitator/route?network=eip155:8453&scheme=exact
```

XGuard is non-custodial and does not rewrite the signed x402 recipient or amount.
