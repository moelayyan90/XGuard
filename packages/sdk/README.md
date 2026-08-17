# @xguard/sdk

Minimal drop-in x402 v2 facilitator client for XGuard.

Production XGuard runs on Base mainnet at `https://xguardgate.com`.

```ts
import { createXGuardFacilitator } from "@xguard/sdk";

const facilitator = createXGuardFacilitator({
  url: process.env.XGUARD_URL ?? "https://xguardgate.com",
  apiKey: process.env.XGUARD_API_KEY,
});
```

The returned object implements the official x402 `FacilitatorClient` interface. Non-local URLs must use HTTPS.

Mainnet uses x402 v2 `exact` on Base (`eip155:8453`) with native USDC. XGuard charges `$0.002` only for a successful billable settlement after the service's earned-finality checks; malformed requests, failed settlements, duplicate retries for the same logical payment, health/discovery calls, and testnet traffic are not billed.

Merchant mainnet use requires an XGuard API key and prepaid service balance. Hosted production integration does not require this SDK: the standard x402 `HTTPFacilitatorClient` can point directly at the XGuard mainnet gateway.

For non-billable testing, use the testnet endpoint explicitly rather than relying on it as a default.
