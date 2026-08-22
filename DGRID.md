# DGrid integration record

Reviewed on 2026-08-22 against current first-party DGrid sources.

## Verified public facts

- [DGrid documentation index](https://docs.dgrid.ai/llms.txt) documents the Model API, Management API Keys, and x402 consumer API.
- The consumer Model API is OpenAI-compatible at `https://api.dgrid.ai/v1`.
- [DGrid Model Marketplace](https://dgrid.ai/marketplace) offers a provider application, self-serve endpoint listing, custom pricing, usage monitoring, model review, and on-chain revenue claims.
- [The official Marketplace announcement](https://blog.dgrid.ai/posts/2026-07-23/) says only approved providers can list models and that listings go through review.
- [Supported Countries and Regions](https://docs.dgrid.ai/ai-gateway/supported-regions) explicitly includes Jordan for commercial API access, while warning that features, payment, and provider availability can differ by region.
- [AI Gateway Terms](https://docs.dgrid.ai/ai-gateway/terms-of-service) prohibit reselling the consumer AI Gateway without DGrid's written permission. XGuard must not use the DGrid consumer API as its upstream.

## Provider-channel boundary

DGrid's public documentation does **not** publish a provider-channel request signature, authentication header, health protocol, usage callback, settlement webhook, price-management API, withdrawal API, or routing-share API. The Marketplace application is therefore the authoritative next step.

XGuard exposes a standard OpenAI-compatible provider endpoint at `https://xguardgate.com/v1`. This is a readiness surface, not a claim that DGrid's unpublished provider-channel contract is identical. The network row remains `provider_interface_status=UNVERIFIED` until onboarding supplies and validates that contract.

## Application status

Current status: `NOT_APPLIED`.

The live form requires provider name, website, contact name, contact email, and at least one Telegram, Discord, or X contact before technical fields are shown. Known business fields are:

- Provider: `XGuard`
- Website: `https://xguardgate.com`
- Description: `High-availability AI inference provider optimized for automated routing, competitive pricing, reliability and low latency.`

No application is submitted until XGuard has at least one real, healthy, resale-approved or self-hosted model route. Model review and acceptance must never be inferred from form submission.

## Opportunity snapshot

The public catalog on 2026-08-22 exposed prices for, among others:

| Catalog model          | Input / 1M | Output / 1M | Evidence type      |
| ---------------------- | ---------: | ----------: | ------------------ |
| Qwen 3.7 Flash         |      $0.03 |       $0.13 | catalog price only |
| DeepSeek V4 Flash 0731 |      $0.22 |       $0.66 | catalog price only |
| Qwen Text Embedding V4 |      $0.07 |          $0 | catalog price only |

DGrid did not publish model-specific request volume, provider count, competition, revenue, or XGuard routing share. Demand, competition, price, cost, latency, margin, and aggregate opportunity scores therefore remain `NULL` with `score_status=INSUFFICIENT_DATA`; the opportunity engine must not turn catalog position into fabricated demand.

## Settlement and payout

Marketplace material says revenue is settled on-chain and uses the phrase “instant on-chain payouts.” It does not specify the settlement asset, chain, confirmation rule, minimum withdrawal, fee, custody model, destination-management method, or automation endpoint. Therefore:

- revenue from requests is `PENDING` until evidenced;
- automatic payout is `NOT_SUPPORTED`;
- routing share is omitted unless DGrid provides it;
- `XGUARD_PAYOUT_DESTINATION` remains a secret and is never submitted without an official destination contract.
