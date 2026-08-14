# XGuard testnet quickstart

This path uses the live Base Sepolia Worker and never charges an XGuard fee. It requires Node.js 22 or newer and a Base Sepolia receiving address. Never place a private key in the resource server.

## 1. Verify the gateway

```bash
curl https://xguard-testnet.maqamapp.workers.dev/readyz
curl https://xguard-testnet.maqamapp.workers.dev/supported
```

Readiness must return HTTP `200`, `mainnet: false`, and at least one measured route. The capability response must advertise only x402 v2 `exact` on `eip155:84532`.

## 2. Run the included paid-resource example

From the repository root:

```bash
npm ci --ignore-scripts
npm run build
cp examples/x402-xguard-starter/.env.example examples/x402-xguard-starter/.env
```

Set only `PAY_TO_TESTNET_ADDRESS` in the copied file to a non-zero Base Sepolia address, then run:

```bash
node --env-file=examples/x402-xguard-starter/.env examples/x402-xguard-starter/dist/server.js
```

In another terminal:

```bash
curl -i http://127.0.0.1:3000/paid
```

The expected first response is HTTP `402` with a `PAYMENT-REQUIRED` header. An official x402 client can sign the selected Base Sepolia requirement and retry with `PAYMENT-SIGNATURE`; the resource server then calls XGuard `/verify` and `/settle`.

## 3. Integrate the SDK

Until the prerelease is published, use the workspace build:

```ts
import { createXGuardFacilitator } from "@xguard/sdk";

const facilitator = createXGuardFacilitator({
  url: "https://xguard-testnet.maqamapp.workers.dev",
});
```

After npm trusted publishing is active, the alpha install path becomes:

```bash
npm install @xguard/sdk@next
npx xguard@next doctor
```

## Safety checks

- `npm run verify:release` runs the complete local release gate.
- `npm run smoke:live` validates the public deployment without making a payment.
- duplicate authorization retries return the cached settlement result and do not create another downstream submission;
- ambiguous post-submit outcomes are quarantined for reconciliation and are never blindly retried;
- Base Sepolia is non-billable and mainnet is hard-disabled.

See [API.md](docs/API.md) and [openapi.yaml](docs/openapi.yaml) for the HTTP contract.
