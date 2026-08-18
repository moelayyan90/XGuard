# @xguard/sdk

Drop-in XGuard integration for x402 facilitators and headless automated-payment clients.

Production XGuard runs on Base mainnet at `https://xguardgate.com`.

## Facilitator integration

```ts
import { createXGuardFacilitator } from "@xguard/sdk";

const facilitator = createXGuardFacilitator({
  url: process.env.XGUARD_URL ?? "https://xguardgate.com",
  apiKey: process.env.XGUARD_API_KEY,
});
```

The returned object implements the official x402 `FacilitatorClient` interface. Non-local URLs must use HTTPS.

## Headless automated payments

XGuard can also be embedded once into an x402 client so every automated payment attempt crosses an XGuard policy gate before the payment payload is created. There is no XGuard page to open and no per-request XGuard call is required by application code after installation.

```ts
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { embedXGuardAutomatedPayments } from "@xguard/sdk";

const client = new x402Client();
// Register the caller's x402 signing schemes on `client` as usual.

embedXGuardAutomatedPayments(client, {
  mode: "auto",
  allowedNetworks: ["eip155:8453"],
  allowedSchemes: ["exact"],
  budgets: [
    {
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      // Base USDC has 6 decimals: 1_000_000 atomic units = 1 USDC.
      maxAtomicAmountPerPayment: "1000000",
      maxAtomicAmountPerWindow: "5000000",
    },
  ],
});

const fetchWithPayment = wrapFetchWithPayment(fetch, client);
const response = await fetchWithPayment("https://merchant.example/paid-api");
```

The budget `asset` must match the exact x402 payment-requirements asset identifier, not merely a ticker symbol.

The guard uses x402's payment-creation lifecycle hook. It runs before signing and can abort an automatic payment based on HTTPS requirements, network, scheme, payee, per-payment atomic caps, rolling-window attempt caps, or an optional asynchronous `authorize` callback.

`mode: "auto"` is deliberately explicit. XGuard does not silently turn payments on, does not receive the caller's private key, and does not bypass wallet, bank, merchant, or payment-provider authorization controls. The optional `authorize` callback is fail-closed: a denial, malformed decision, or policy-service failure blocks payment creation.

Window accounting is intentionally conservative: an allowed payment-creation attempt consumes the configured window budget even if a later transport or settlement step fails. Applications can inspect or reset the in-process attempt accounting through the returned guard handle.

## Mainnet economics

Mainnet uses x402 v2 `exact` on Base (`eip155:8453`) with native USDC. XGuard charges `$0.002` only for a successful billable settlement after the service's earned-finality checks; malformed requests, failed settlements, duplicate retries for the same logical payment, health/discovery calls, and testnet traffic are not billed.

Merchant mainnet use requires an XGuard API key and prepaid service balance. Hosted production integration does not require this SDK: the standard x402 `HTTPFacilitatorClient` can point directly at the XGuard mainnet gateway.

For non-billable testing, use the testnet endpoint explicitly rather than relying on it as a default.
