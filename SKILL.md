---
name: xguard
version: 0.1.0
license: Apache-2.0
description: Configure, migrate, and diagnose x402 v2 resource servers that use the hosted XGuard facilitator gateway on Base mainnet. Use when an agent needs to route x402 verification/settlement through XGuard, enable Bazaar discovery, inspect XGuard capabilities, or validate a resource-server integration.
compatibility: Requires network access to https://xguard-mainnet.maqamapp.workers.dev. Resource-server integration currently targets x402 v2 exact payments on Base mainnet USDC.
metadata:
  author: moelayyan90
  homepage: https://github.com/moelayyan90/XGuard
  provider: https://xguard-mainnet.maqamapp.workers.dev/.well-known/x402/facilitator.json
---

# XGuard

Use XGuard as the merchant-facing x402 v2 facilitator-compatible gateway for Base mainnet USDC. Do not invent capabilities: read the live provider metadata and `/supported` response before changing an integration.

## Read-only discovery first

1. Fetch `https://xguard-mainnet.maqamapp.workers.dev/.well-known/x402/facilitator.json`.
2. Fetch `https://xguard-mainnet.maqamapp.workers.dev/supported` and confirm x402 v2, `exact`, and `eip155:8453` are currently supported.
3. Fetch `/readyz`; do not migrate production traffic unless it reports ready.
4. Use `/discovery/resources` or the Remote MCP endpoint `/mcp` when the task is to discover paid resources cataloged by XGuard.

## Integrate an existing x402 resource server

Prefer the standard x402 `HTTPFacilitatorClient`; an XGuard-specific package is not required.

```ts
import { HTTPFacilitatorClient } from "@x402/core/http";

const headers = {
  Authorization: `Bearer ${process.env.XGUARD_API_KEY}`,
};

const facilitator = new HTTPFacilitatorClient({
  url: "https://xguard-mainnet.maqamapp.workers.dev",
  createAuthHeaders: async () => ({
    verify: headers,
    settle: headers,
    supported: headers,
    bazaar: headers,
  }),
});
```

Keep the resource server's advertised `payTo`, amount, scheme, network, and asset truthful. XGuard's service fee is separate from the seller-advertised x402 payment amount.

## Merchant onboarding

When the user has asked to activate XGuard for their service:

1. `POST /v1/register` with the service name.
2. Capture the returned API key exactly once and store it as a secret; never commit or print it into public logs.
3. Check `/v1/balance` with the Bearer key.
4. A billable mainnet settlement requires enough prepaid XGuard service balance. Creating or funding a top-up transfers real USDC, so obtain the user's explicit approval before moving funds.

Do not fabricate credits, fake settlements, or synthetic customer traffic.

## Bazaar discovery

For a paid HTTP API or MCP tool, attach valid x402 v2 Bazaar extension metadata to the resource declaration. XGuard validates eligible Bazaar metadata and catalogs accepted resources. Confirm discovery through `/discovery/resources` after the integration actually exercises the valid discovery path.

Do not register a facilitator endpoint itself as a paid seller resource merely to inflate discovery counts.

## Settlement safety

- Treat `success: true` only according to the normal x402 response contract.
- Do not blindly retry a settlement after an uncertain post-submission outcome.
- If XGuard reports an ambiguous settlement, preserve the payment identity and let reconciliation resolve it.
- Duplicate retries for the same logical authorization must remain idempotent.
- Use `/status` for operational state and the live `/supported` response for signer/capability attribution.

## Diagnostics

Before handing off an integration, verify:

- `/healthz` is live;
- `/readyz` is ready;
- `/supported` includes the intended payment kind;
- the resource server reaches a valid `402 Payment Required` before body validation blocks an unauthenticated payment probe;
- Bazaar/OpenAPI metadata matches the runtime route;
- secrets are absent from source control;
- no testnet assumptions are used for Base mainnet.

If the CLI is available, `xguard doctor` can supplement these checks. The hosted HTTP integration remains the canonical path.

## Boundaries

XGuard is an independent routing/facilitator gateway. Do not describe it as an official x402 Foundation, Coinbase, Base, Circle, Cloudflare, xpay, PayAI, or OKX product. The current settlement execution is routed; use the live provider manifest for the current downstream attribution boundary.
