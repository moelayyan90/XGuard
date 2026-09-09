# XGuard product refoundation

Audit date: 2026-09-09. Baseline: `72a28716af751345624b7bc321f3579ffebe5e3e`.
Externally observed deployed build: `git-68b1a2f56a93`.

## Evidence before code changes

Inventory covered all repository applications, shared packages, SDK, integration examples,
documentation and deployment/distribution workflows. Runtime review follows the actual
`canonical-entry → a2a → webmcp → discovery → paid-agent → product` chain, including
payment, Durable Object state, public network policy, egress credentials and tests.
Older action, facilitator and gateway entrypoints remain compatibility infrastructure.

The anonymous production metrics response at 2026-09-09 06:07 UTC reported:

| Event | Count |
| --- | ---: |
| discovery | 6,764 |
| tools_list | 3,188 |
| tools_call | 117 |
| quote_attempt | 28 |
| quote_failed:invalid_input | 25 |
| preflight:rejected | 27 |
| recognized revenue / settled cash | 0 / 0 USD micros |
| successful paid executions / repeat paying wallets | 0 / 0 |

These are event counts, not unique people or session conversion rates. Historical
backfill is incomplete. Nothing here establishes willingness to pay or adoption.
Source: https://api.xguardgate.com/v1/metrics . The newest main CI run failed and its
dependent deploy was skipped; the preceding build remains deployed.

## Root causes

1. The hero sells credential control. The anonymous paid product delivers one public
   HTTP response for 0.001 USDC. A caller with fetch already owns most of that outcome.
2. Secretless actions require an operator account at a vendor, stored credentials,
   a scoped capability and prepaid credits. That is valuable in an installed workflow,
   but it is not the promised zero-setup anonymous first result.
3. Discovery advertises unavailable search, inference and data-query entries. Provider
   presets are credential templates, not funded providers or resale agreements.
4. Eleven tools are assembled across layered MCP implementations; GET MCP and tools/list
   differ. Several A2A skills explain infrastructure rather than execute work.
5. The live demo generates a 402; it does not demonstrate delivery of a useful result.
6. `/agent.txt`, `/v1/capabilities/{id}` and outcome landing pages return 404.
7. Existing protected payment execution is reusable; rewriting settlement would add risk.
8. Most telemetry cannot connect discovery to paid delivery. Counters are not cohorts.

## Baseline effort

| Path | XGuard requests, excluding wallet/RPC traffic | Client concepts |
| --- | --- | --- |
| Root → direct paid fetch → signed retry | 3 | URL, x402 payer, quote/header preservation |
| Root → capabilities → quote → execution challenge → retry | 5 | tool identity, input envelope, network, quote, payment |
| Secretless action after root | at least 4 plus checkout/vendor setup | vendor account/schema, operator key, stored credential, scoped capability, credit balance, write idempotency |

The shortest fetch path already exists. Renaming it would not create value. The change
must produce normalized, deduplicated, source-attributed outcomes across multiple sources.

## Implementation decision

Use one `/v1/execute` contract over the existing signed quote, payment verification,
settlement, replay state, credit and proof pipeline. Start three bounded public-source
outcomes: page evidence extraction, structured product offers, and RSS/Atom feed digest.
Add a free local extraction preview using the same parsers. No fabricated search,
paid model, PDF/OCR or arbitrary API write capability.

Natural language is a bounded intent recognizer, not an undisclosed general AI model.
Ambiguous or unsupported jobs receive specific repair instructions. A URL plus desired
action, JSON, supported OpenAPI/MCP/A2A envelopes and safe GET curl input normalize to
the same operation. Unknown writes and supplied secrets are rejected, never silently
turned into a different task.

Public discovery exposes executable outcomes only. Legacy APIs remain callable, but
the default MCP list and first-use pages focus on discover, execute and recover result.
Source/provider selection must use capability fit and actual observed health; absent
history is unknown. Fallback is bounded and limited to safe reads. Product/feed output
does not establish content truth or independent corroboration.

## Security and economics boundaries

Keep verification and settlement before paid source access. Bind capability, all source
URLs, freshness, limits and payment environment to the quote. Replayed authorizations
cannot fund a different capability. Failed delivery retains the existing execution-credit
liability policy. Share caches only when origin cache policy permits; price-sensitive
offers use fresh reads. Fixed price includes bounded fallback, with no surprise charges.

The existing DNS guard checks resolver answers but does not pin the TLS connection to
the checked address. Do not claim complete DNS-rebinding prevention. New network work
must preserve private-address rejection, HTTPS/443, manual redirects, bounded streams,
timeouts, hostname normalization and no forwarded customer credentials. This residual
transport limitation must stay explicit until an IP-pinned transport is deployed.

## Success and release evidence

Actual release evidence and the seven requested E2E flows are recorded in
`REFOUNDATION_VERIFICATION.md`. Local simulated settlement is not an on-chain payment.
Deployment, registry submission, indexing, customers and revenue are separate outcomes.
The selected commercial hypotheses require paid repeat use to validate them; adding
working code alone cannot prove that the product-market problem has been solved.
