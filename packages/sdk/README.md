# @xguard/sdk

Minimal drop-in x402 v2 facilitator client for an XGuard gateway.

```ts
import { createXGuardFacilitator } from "@xguard/sdk";

const facilitator = createXGuardFacilitator({
  url: process.env.XGUARD_URL ?? "https://xguard-testnet.maqamapp.workers.dev",
  apiKey: process.env.XGUARD_API_KEY,
});
```

The returned object implements the official x402 `FacilitatorClient` interface. Non-local URLs must use HTTPS. The public URL is Base Sepolia testnet-only and never bills an XGuard fee.
