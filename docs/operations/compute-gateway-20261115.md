# XGuard Compute — production activation record

## Release scope

Added a compute product inside XGuard. The existing Worker, domains, Durable
Object bindings/migrations, witness identity, facts, payment routes and receipts
remain in place. Compute uses the existing `PaidGatewayState` class in a new
named instance, with the existing ProofAuthority ES256 key. No migration is
required and no stored financial state is rewritten.

Execution routes:

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/inference/quote` | Input-bound, signed inference offer |
| POST | `/v1/inference/execute` | Settle once, route and execute |
| POST | `/v1/gpu/quote` | Reviewed GPU template offer |
| POST | `/v1/gpu/execute` | Submit bounded serverless job |
| POST | `/v1/compute/route` | Select inference_proxy or gpu_job_execute |
| GET | `/v1/compute/providers` | Configuration and exact blockers |
| GET | `/v1/compute/models` | Eligible configured models/templates |
| GET | `/v1/compute/availability` | Eligible model availability |
| GET | `/v1/compute/health` | Configuration and authenticated health |
| GET | `/v1/compute/proof-key` | Existing public verification key |
| GET | `/v1/compute/executions/{quote_id}` | Recover original purchase |
| GET | `/v1/compute/receipts/{quote_id}` | Recover result and signed receipt |
| GET | `/v1/compute/metrics` | Existing operator Bearer authentication |

Recovery requires the original private `X-XGuard-Quote` bearer capability. Do not
put quotes, authorizations, prompts, credentials or private results in public
issues or logs. The eight compute tools are also exposed through MCP and A2A
(`xguard.compute.<tool_name>`). Payment resources always name the canonical HTTP
execute endpoint, including when discovered through those transports.

## Verified activation blockers

On 2026-11-15 the signed-in Cloudflare settings page showed the existing
`LIVE_ADMIN_KEY`, treasury and x402 configuration, but **no** OpenRouter, Together,
RunPod or Akash provider credential. The local execution environment also had no
provider or buyer signing credential. No provider account balance, model-specific
resale grant or GPU endpoint was available to verify.

Consequently no paid compute provider is activated by this release. Provider
discovery is public, while quotes fail without requesting payment if no eligible
upstream exists. No automatic credit purchase, auto recharge, subscription,
provider account creation or unfunded wallet is used as a substitute.

An actual economic canary has not run. Local cryptographic, chain and upstream
fixtures are explicitly synthetic. An HTTP 200, matching receipt fixture or
configured receiving address is not money received, a real upstream job, a sale
or proof of positive realized net profit.

## Provider terms checked on 2026-11-15

| Provider | Evidence | Activation decision |
| --- | --- | --- |
| OpenRouter | [Terms](https://openrouter.ai/terms), especially sections 5.1–5.9 permit incorporating models into customer products subject to model terms and customer restrictions. | Adapter implemented. Requires an actual funded API key, approved model list and review of model terms for this specific proxy use. No blanket resale approval inferred. |
| Together | [Terms](https://www.together.ai/terms-of-service), section 4.3 prohibits standalone resale and competing services. | Adapter remains disabled; a specific applicable written agreement is required. |
| RunPod | [Terms](https://www.runpod.io/legal/terms-of-service), section 9 restricts credit resale, site commercial exploitation and competition. | Serverless adapter implemented but disabled pending permission for this model and a reviewed bounded endpoint. |
| Akash | [Console terms](https://console.akash.network/terms-of-service) and [Homenode terms](https://homenode.akash.network/terms-of-service). Homenode terms do not grant standalone resale. | Not connected. Lease signer, funded escrow, deployment/provisioning and lease close-out are not implemented in this release; do not advertise executable Akash capacity. |
| Fireworks | [Terms](https://fireworks.ai/terms-of-service), service resale restrictions. | Not connected or offered as a fallback. |

Provider or customer access refusals never trigger another provider to bypass
the restriction. Country eligibility uses trusted Worker `request.cf.country`,
not a customer JSON field or a caller-supplied country header. No sanctions,
export, geographic, account-ban or model restrictions are disabled.

## Activation configuration

Keep keys in Worker secrets. Put `XGUARD_COMPUTE_PROVIDERS` in a Worker secret as
well so a future Wrangler deployment does not remove a dashboard-only variable.
The source template is `integrations/compute/providers.example.json`; it is
deliberately disabled and contains no asserted prices, balances or permissions.

This release is a reader/discovery deployment: compute purchases require the
explicit `XGUARD_COMPUTE_ENABLED=on` activation secret after the funded provider,
cost controls and recovery path have been validated. It defaults to paused.
Before activation retain this compute-aware Worker version as the rollback
point; a pre-compute version cannot serve new compute obligations.

For each enabled provider, supply:

- The actual `OPENROUTER_API_KEY`, `TOGETHER_API_KEY` or `RUNPOD_API_KEY`.
- `enabled`, a verified resale permission reference and review date no older
  than 30 days; model terms, country eligibility and a hard cost bound must be
  reviewed for this exact workload/service arrangement.
- Explicit `request_cap_atomic`, `daily_cap_atomic`, prepaid available balance,
  optional low balance threshold and an audited balance epoch. Caps never
  purchase additional credit. Change an epoch only after reconciling outstanding
  reservations and an actual new balance. Account-side credit caps and disabled
  auto recharge are also required to bound spending outside this gateway.
- Inference allowlist: model ID, `license_reviewed`, a model `terms_reference`, context size, maximum input/output microUSD per
  million tokens and any request fee. OpenRouter live prices must remain within
  these ceilings; provider maximum-price constraints are sent on execution.
- RunPod allowlist: template ID, endpoint ID, immutable image digest, command,
  GPU type, region, runtime cap, maximum per-second cost, startup/cleanup
  allowance and any fixed charge. The endpoint must enforce these limits.

OpenRouter health authenticates `/key` and `/credits` and checks sufficient
remaining credit. Together validates an authenticated model catalog. RunPod
checks its configured endpoint health. A health probe is not a reservation of
physical GPU availability and cannot guarantee successful execution.

Pricing defaults and overrides:

| Setting | Default |
| --- | --- |
| `XGUARD_COMPUTE_MARKUP_BPS` | `2500` (25% markup) |
| `XGUARD_COMPUTE_PRICE_SAFETY_BPS` | `1000` (10% upstream allowance) |
| `XGUARD_COMPUTE_REQUEST_CAP_ATOMIC` | `1000000` (1 USDC) |
| `XGUARD_COMPUTE_DAILY_QUOTE_CAP` | `100` |
| `XGUARD_COMPUTE_PAYMENT_COST_ATOMIC` | `0` configured budget; must be reviewed against actual facilitator fees |
| `XGUARD_COMPUTE_INFRA_COST_ATOMIC` | `100` configured budget |

`XGUARD_COMPUTE_MARKUP_RULES` supports `customer:<class>`, `task:<template/model>`,
`gpu:<type>`, `model:<id>`, `provider:<id>` and `route:<route>` in that priority.
`XGUARD_COMPUTE_CUSTOMER_CLASSES` maps verified payer addresses to classes; a
customer-class quote binds the payer and requires its actual payment signature.
An unverified customer-supplied class is never accepted.

The fixed customer price is the conservative upstream allowance, its markup,
payment budget and infrastructure budget. Unused token allowance is disclosed
as part of the fixed price. A 25% markup is 20% of revenue before other costs.
Output tokens, text-only messages, request bytes and result storage are bounded;
multiple samples, arbitrary tools, web search, images, audio and streaming are
not silently enabled. A pre-payment reprice that exceeds the bound requires a
new quote. After settlement, no route may exceed the paid bound; an unavailable
safe route creates a recorded liability rather than an unpriced execution.

## Financial and execution safety

The verified signature reserves both idempotency and prepaid provider capacity
transactionally **before settlement**. The same nonce-named object used by the
existing gateway prevents cross-product authorization reuse. Settlement is
submitted once; canonical USDC AuthorizationUsed and Transfer events plus a
subsequent block are required before execution. Ambiguous settlement recovery
only reads the chain. It never resubmits `/settle`.

After settlement, an atomic execution claim and each upstream cost reservation
precede the request. An explicit 429 may release a reservation and choose a
compatible fallback; timeouts, uncertain 5xx and interrupted execution retain a
reservation and stop in `EXECUTION_UNKNOWN`. No duplicate job is launched to
guess whether a prior request succeeded. GPU jobs retain their upstream ID and
poll the same job. Results are persisted before receipt signing, so a signing
failure can be recovered without another upstream execution.

Unpaid offers expire and are cleaned in bounded batches after a ten-minute
alarm. Paid quotes, financial evidence, unknown outcomes and liabilities are
preserved. Collection and witness budgets are independent. This does not expand
the Cloudflare plan or promise account-wide quota avoidance.

**Remaining implementation limitations:** arbitrary container/GPU provisioning,
Akash lease lifecycle, automated refunds/payout signer integration, automatic
reconciliation of an inference that timed out without a provider request ID,
and invoice ingestion for finalized profit are not connected. Failed paid jobs
remain explicit refund liabilities; uncertain jobs require reconciliation.
RunPod invoice costs and Together actual costs are unknown when not returned
by the provider. Those states must never be reported as zero-cost profit.

## Accounting, validation and canary

Each successful receipt binds the request, route, model/GPU, provider class,
timestamp, customer price, response digest, settlement reference and accounting.
OpenRouter usage cost is a provider-reported accrual. Network/infrastructure
amounts are configured budgets. `net_margin_atomic` is null for an unknown
upstream cost, and `positive_margin_proven` remains false until actual invoices
and payment costs can be reconciled. Own-wallet canaries cannot establish
independent customer demand or revenue.

The runtime fixture `apps/relay/test/compute-workerd.mjs` uses actual workerd
SQLite claims, the official x402 EVM signer and ES256 verification, while
intercepting every financial, chain and provider request. It covers concurrent
retries, digest binding, authorization reuse, explicit rate-limit failover,
restriction denial, uncertain execution, chain-evidence recovery and unknown
cost accounting. It is part of CI.

`node scripts/compute-production-check.mjs` performs read-only production
discovery checks and reports real-canary status separately. JavaScript and
Python purchase examples are in `integrations/compute`; the JS client verifies
the signed receipt. They require an explicitly configured, funded buyer and
maximum spend. The recovery file is private and must be retained; it is not a
provider credential. A real purchase can be run only after provider activation.

Discovery distribution is prepared in README, OpenAPI, MCP, A2A, agent card,
`server.json` and `llms.txt`. External directory/community submission is deferred
until a real economic canary succeeds; no synthetic test is advertised as live
paid capacity or a verified provider partnership.
