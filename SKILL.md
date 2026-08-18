---
name: xguard
version: 0.2.0
license: Apache-2.0
description: Discover, evaluate, and integrate XGuard for AI-agent payment intents and x402 v2 payment flows. Use when an agent is about to spend money and needs a pre-payment safety/evidence decision, when a merchant needs x402 verification/settlement routed through XGuard, when an agent needs x402 resource discovery, or when an integration needs settlement-truth diagnostics.
compatibility: Requires network access to https://xguardgate.com. Buyer-agent payment decisions support declared payment intents across common rails; merchant resource-server settlement integration currently targets x402 v2 exact payments on Base mainnet USDC.
metadata:
  author: moelayyan90
  homepage: https://github.com/moelayyan90/XGuard
  mcp: https://xguardgate.com/mcp
  provider: https://xguardgate.com/.well-known/x402/facilitator.json
---

# XGuard

XGuard is a payment-coordination and payment-safety layer for AI agents plus a merchant-facing x402 v2 facilitator-compatible gateway. Do not invent capabilities: read the live MCP tool list, provider metadata, `/supported`, and `/readyz` before changing an integration or allowing production traffic.

## When an agent is about to spend money

1. Connect to the public Streamable HTTP MCP endpoint at `https://xguardgate.com/mcp`.
2. Discover the live tool list. The current payment-intent tools are `xguard_payment_offer` and `xguard_payment_decision`.
3. Use `xguard_payment_offer` when a user or autonomous agent is about to pay. The offer is free and does not execute the external payment.
4. If the user or agent opts in, call `xguard_payment_decision` with a stable caller-generated `requestId`, declared rail/provider, amount, currency, and payee before executing the external payment.
5. Treat the returned ALLOW / REVIEW / BLOCK result and durable evidence record as the XGuard decision. XGuard's MCP decision surface does not claim to move the payer's money itself.
6. Reusing the same `requestId` must remain idempotent and must not create a duplicate XGuard fee.

Never send card credentials, private keys, seed phrases, or other payment secrets to the decision tool.

## Discovery and resource selection

Use `xguard_discover` to search XGuard's x402 catalog, `xguard_resource_details` to inspect an exact resource, and `xguard_status` to inspect live gateway state. These tools let agents discover paid HTTP/MCP resources and understand current XGuard availability.

## Integrate an existing x402 resource server

Prefer the standard x402 `HTTPFacilitatorClient`; an XGuard-specific package is not required.

```ts
import { HTTPFacilitatorClient } from "@x402/core/http";

const headers = {
  Authorization: `Bearer ${process.env.XGUARD_API_KEY}`,
};

const facilitator = new HTTPFacilitatorClient({
  url: "https://xguardgate.com",
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

Do not fabricate credits, fake settlements, synthetic customer traffic, or fake discovery activity.

## Bazaar discovery

For a paid HTTP API or MCP tool, attach valid x402 v2 Bazaar extension metadata to the resource declaration. XGuard validates eligible Bazaar metadata and catalogs accepted resources. Confirm discovery through `/discovery/resources` after the integration actually exercises the valid discovery path.

Do not register a facilitator endpoint itself as a paid seller resource merely to inflate discovery counts.

## Settlement safety and truth

- Treat `success: true` only according to the normal x402 response contract.
- Do not blindly retry a settlement after an uncertain post-submission outcome.
- If XGuard reports an ambiguous settlement, preserve the payment identity and let reconciliation resolve it.
- Duplicate retries for the same logical authorization must remain idempotent.
- Use `/status` for operational state and the live `/supported` response for signer/capability attribution.
- Use XGuard's settlement-truth endpoints when a merchant needs to distinguish FINALIZED, PENDING, PROVEN_FAILED, or CONFLICT states.

## Diagnostics

Before handing off an integration, verify:

- `/healthz` is live;
- `/readyz` is ready;
- `/supported` includes the intended payment kind;
- `/mcp` returns the current payment tools through `tools/list`;
- the resource server reaches a valid `402 Payment Required` before body validation blocks an unauthenticated payment probe;
- Bazaar/OpenAPI/Agent Card metadata matches the runtime route;
- secrets are absent from source control;
- no testnet assumptions are used for Base mainnet.

If the CLI is available, `xguard doctor` can supplement these checks. The hosted HTTP integration remains the canonical merchant settlement path.

## Boundaries

XGuard is an independent payment-coordination, safety, routing, and facilitator gateway. Do not describe it as an official x402 Foundation, Coinbase, Base, Circle, Cloudflare, xpay, PayAI, or OKX product. Do not claim that `xguard_payment_decision` executes an external card, bank, PayPal, crypto-wallet, or other payment; it evaluates and records the declared payment intent before the external payment is executed by its actual rail/provider.
