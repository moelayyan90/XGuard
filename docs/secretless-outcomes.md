# Durable delegated API actions

XGuard's focused outcome is a protected external action: an agent can use an operator's scoped API permission, receive execution evidence, and retry a lost response without repeating the same gateway charge or upstream write. The intended first customers are agent platforms and SaaS teams running recurring authenticated business workflows. Customer willingness to pay remains a hypothesis to validate with external paid usage.

## Operator setup

1. Purchase XGuard Usage Credits through the existing checkout.
2. Provision an upstream credential at `POST /v1/egress/credentials` using the operator's `X-XGuard-Key`. Restrict its origin, paths and methods.
3. Issue a short-lived capability at `POST /v1/egress/capabilities`. Set `max_calls`, `max_credits_per_call` and `max_total_credits`; pass only the resulting capability to the agent.
4. Keep the returned `capability_id` to revoke it with `DELETE /v1/egress/capabilities/{capability_id}` and the same operator key.

The operator must own an authorized vendor account. XGuard is not a marketplace of pooled provider accounts, and the vendor's API request and response schemas still apply. Gateway credits do not include or limit the vendor's own fees. Existing provider policy templates are not resale agreements or measured provider availability.

## Agent execution

```js
import { createXGuardAgentClient } from "xguard-x402-control-plane";

const agent = createXGuardAgentClient(process.env.XGUARD_CAPABILITY);
const response = await agent.fetch(
  "https://api.github.com/repos/your-org/your-repo/issues",
  {
    method: "POST",
    idempotencyKey: "support-escalation-case-123-v1",
    json: { title: "Investigate customer case 123" },
  },
);
const executionId = response.headers.get("x-xguard-execution-id");
const proof = response.headers.get("x-xguard-proof");
const result = await response.json();
```

Provision a suitably scoped GitHub credential before running this example. The agent receives no GitHub token. Validate the returned HTTP status before treating the action as successful.

## Retry and budget contract

| Situation | Behavior |
| --- | --- |
| POST, PUT, PATCH or DELETE without a key | HTTP 400 before billing or upstream execution |
| Same capability, key and exact request | Stored HTTP status, body and signed proof; `X-XGuard-Replay: true`; no new charge or upstream request |
| Same key, changed URL/query, method, headers or serialized body | HTTP 409 `idempotency_request_conflict` |
| Concurrent copy while the first attempt is active | HTTP 409 `execution_in_progress`; poll with the same key |
| Reserved attempt with no recoverable result | HTTP 409 `execution_outcome_unknown`; never automatically execute it again |
| Transport timeout, blocked reflected secret, or oversized response after billing | Stored ambiguous result; no automatic reexecution or cash refund |
| Price exceeds per-call or remaining capability budget | HTTP 402 before billing and credential release |
| Revoked or expired capability | Stored-result access and new attempts are denied; already authorized in-flight work may finish |
| Known pre-billing failure | Credit reservation is released; the attempted call still counts toward `max_calls` |

Use the same business key for a retry. Keys are 8–128 ASCII letters, digits, underscores, colons, periods or hyphens. REST also accepts `Idempotency-Key`; conflicting header/body keys fail. GET and HEAD require an explicit key if the caller wants replay protection. A new key means a new authorized attempt. Never generate a new key automatically to escape an ambiguous outcome.

The guarantee is at most one XGuard upstream attempt per capability and key. It is not a universal distributed exactly-once guarantee. If an upstream service performs an action but its response is lost, XGuard cannot prove whether that action completed. Provider idempotency support is additional protection, not an assumed capability.

Capability lifetime is 30–3600 seconds. Replay is available only while the capability remains valid. Encrypted results are scheduled for deletion 24 hours after capability expiry. This is an operational retry store, not a permanent audit archive. Save required receipts in the customer's own audit system.

Request bodies are limited to 1 MiB, buffered upstream results to 48 KiB, response headers to 8 KiB, and upstream requests to 30 seconds. Streamed and large-result workflows need a separate contract. Redirects are returned without following them. The SDK also disables automatic gateway redirects.

The response filter blocks known literal, encoded and base64 credential reflections and sensitive response headers. It cannot guarantee detection of every transformation of a secret by a malicious provider. Public DNS checks reject known private targets before billing; the transport is not pinned to those resolved IPs, so DNS rebinding is a residual risk. Restrict delegated origins to trusted vendors.

## Proof and discovery

`GET /v1/capabilities` includes `xguard_egress_fetch`, its machine-readable input, credit pricing, operator authentication requirements, retry policy and proof semantics. The execution endpoint remains `/v1/egress/fetch`. MCP exposes the same contract through `xguard_egress_fetch`, including status, execution ID, proof and replay fields for JSON responses. OpenAPI describes the write key, budgets and revocation endpoint.

The ES256 proof binds the request digest, response-body hash, execution ID, scope, gateway credits and outcome state. It attests what XGuard observed and returned; it does not independently prove the provider's business records, guarantee data truth, or prove a new cash settlement for prepaid credits. Verify via `POST /v1/proofs/verify` or the published JWKS.

## Unit economics and measurement

Public `xguard.web.fetch` keeps its existing fixed price: 1,000 USDC atomic units ($0.001). Its paid provider cost is zero because it performs public HTTPS fetching. This does not mean its total service cost is zero.

The operator now configures an infrastructure budget of 100 USD micros per attempt, a payment budget of zero, and a minimum contribution policy of 2,000 basis points. The payment budget assumes the currently published xPay sponsored Base settlement terms. These are budget inputs, not measured costs or a promise of profitability.

`floor = ceil((infrastructure budget + payment budget) / (1 - minimum contribution rate))`

Current inputs yield a floor of 125 micros and an estimated first-attempt contribution of 900 micros (90%). Two execution attempts yield an estimated 800 micros. Missing/invalid budgets or a fixed price below the floor disable paid quotes. This protects the configured budget model; it cannot detect an unreported invoice increase. Provider routing, volume discounts, tiered plans and SLA premiums are not offered without validated suppliers, costs and service differences.

The existing prepaid egress rail has separate card-processing economics. Credits consumed are usage, not verified cash or revenue. Obtain actual checkout net proceeds, refunds, currency conversion and infrastructure allocation before calculating that rail's gross profit. Do not apply the public-fetch estimate to egress credits.

`GET /v1/metrics` now exposes a deduplicated delivery ledger alongside legacy funnel counters:

- External production settled cash, recognized revenue after gateway delivery, and undelivered liabilities.
- Successful paid executions, revenue per successful execution, hashed paying-wallet counts and repeat paying wallets.
- Observed revenue per paying wallet, which is not forecast lifetime value.
- Estimated contribution for budgeted executions. Actual gross profit and net profit remain `null` until costs are reconciled.

Tests, synthetic traffic and an identifiable payer-to-self treasury transfer do not count as external revenue. Wallets are not necessarily distinct customers. The new ledger has no historical backfill; a zero value does not establish all-time company revenue. After repeated synchronization failures, a `commerce_accounting_pending` event requires operator investigation. Existing mean latency is not P95, and no invented SLA or reputation score is published.

## Release verification

CI exercises real cryptography and production handlers with simulated billing, DNS and providers: scoped authorization, concurrent retries, credit budgets, state restart, ambiguous billing, result-storage failure, secret reflections, revocation and signed outcome replay. Payment tests simulate verify/settle responses; they are not blockchain purchases.

Deployment verifies production identity, executable MCP/HTTP contracts, payment readiness and 402 challenges. `scripts/inspect-commercial.mjs` records read-only production counters. A 402 challenge and readiness response do not prove a customer paid. A real paid end-to-end claim requires an externally funded settlement or verified paid-credit account, a useful delivered action and a verifiable receipt.

## Technical and market references

- [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests): vendors may already provide their own retry protection.
- [Composio](https://composio.dev/): managed authentication and agent integrations already have competitors.
- [Cloudflare spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/): existing budget controls are documented as eventually consistent.
- [Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) and [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/): use billable usage and invoice allocation to replace budgets with actual costs.
- [xPay facilitator terms](https://docs.xpay.sh/en/x402-protocol/facilitator): verify current verify/settle fees and gas-sponsorship conditions before changing payment budgets.
- [Lemon Squeezy fees](https://docs.lemonsqueezy.com/help/getting-started/fees): card-credit purchases incur processing and potentially additional fees; use actual net receipts when allocating costs.
