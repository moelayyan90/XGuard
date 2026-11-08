# XGuard Route Network — bounded production foundation

This release adds separately priced operations to the existing x402 v2 purchase,
settlement, signed-delivery and recovery engine. It does not establish a real
customer sale, owner bank settlement or universal autonomous execution.

## Available scope

| Operation | API alias | USDC per bounded operation |
| --- | --- | ---: |
| Resolve an intent against the curated capability catalog | POST /v1/routes/resolve | 0.005 |
| Compare four provisional route rankings | POST /v1/routes/compare | 0.005 |
| Discover matching catalog services and check official documentation | POST /v1/discover | 0.010 |
| Inspect three public metadata paths of a supplied platform | POST /v1/discover/platforms | 0.015 |
| Crawl and extract one robots-permitted public page | POST /v1/crawl | 0.015 |
| Retrieve the current npm version from the official registry | POST /v1/facts | 0.010 |
| Create a durable public-read task | POST /v1/tasks | 0.030 |
| Create a bounded durable schedule | POST /v1/schedules | 0.030 |
| Independently check an expected HTTP status | POST /v1/verify | 0.010 |

Canonical paid resources are `/api/paid/v1/{service}`. Aliases return offers
bound to those canonical resources. Before signing, inspect the exact resource,
price and input. Preserve the original body, idempotency key, quote and payment
identifier. Recover uncertain delivery with the original quote; never sign a
replacement purchase to resolve a lost response.

The prices exceed the configured 0.0015 USDC infrastructure cost budget and the
existing minimum contribution threshold. These are budgets, not measured costs
or verified net profit. Do not claim positive realized margin without invoices.

## Persistence and execution

No Durable Object migration or new binding is introduced. Existing financial
objects and stored receipts remain in place. New records use isolated names in
the existing `PAID_GATEWAY` namespace:

- `network:xgtask_*`: private task state, scoped bearer token, completed outputs,
  checkpoint hashes, retry history and visible dead-letter state.
- `network:global-capability-graph-v1`: public-service documentation evidence and
  bounded source-change history. Private task inputs never enter this object.
- Existing per-payment records: authorization, actual settlement reference,
  immutable delivery artifacts and idempotent accounting.

Task creation requires the settled payment identifier supplied by the financial
engine. The task ID derives from that identifier, preventing creation of a
second task during delivery recovery. The scoped task token is returned through
the signed purchased result and omitted from status responses.

Each task permits at most 3 public read-only steps, or at most 3 total scheduled
step executions. Each step has at most 3 attempts and one optional explicit
fallback URL. Completed checkpoints are never rerun during recovery. Repeated
429 responses produce WAITING_FOR_QUOTA and finally a visible FAILED dead letter.
No hidden provider purchases, unlimited retries, credit or financial exposure
are authorized by these tasks. Resume and status access are included in the
original bounded task fee; they do not trigger another settlement.

One-shot schedules may run up to 30 days ahead. Bounded recurrence uses a minimum
60-second interval. `http_healthy` retries within the same 3-attempt budget.
Arbitrary price triggers, webhook triggers, unlimited monitors and general DAG
execution are not implemented by this release.

## Discovery and truthfulness

The catalog begins with explicitly curated official references. The existing
10-minute scheduler checks at most 3 documentation resources per discovery batch;
each catalog cycle then backs off for 24 hours. It preserves source hashes,
retrieval times, failure states and at most 100 observed changes. A successful
documentation retrieval is DOCUMENTATION_REACHABLE, not verified provider
capability, regional eligibility, pricing or paid execution.

Natural-language routing currently uses deterministic capability matching. It
does not infer arbitrary compound-task dependencies or measured success rates.
Missing provider cost, latency, quota and completion history remain null or
UNKNOWN. All four ranking strategies explicitly state their limited evidence.
Only one supported internal capability can be labeled directly executable;
external deployments, stores, email and model actions require future adapters.

Network fetches validate HTTPS public hosts and DNS using the existing security
engine, reject cross-origin redirects before following them, check robots.txt,
disable source-response caching, limit body size and timeouts, and never execute
provider-supplied scripts or metadata instructions. User-facing result rendering
uses textContent or HTML escaping.

## Machine interfaces and frontend

The existing MCP server advertises the additional bounded tools. The existing
A2A SendMessage surface accepts `xguard.network.*` paid actions; the namespace
preserves legacy discovery behavior. Both transports use the canonical HTTP x402
resource rather than reinterpreting payment scope. OpenAPI includes every
canonical purchase schema, aliases and authenticated task lifecycle routes.

`/network`, `/routes`, `/network/docs` and 11 task-directory URLs provide the
Arabic workspace, exact prices and scope. Directory pages are purchase previews,
not free computed route answers. The workspace requests quotes but does not
possess a customer wallet or fabricate a card checkout. Legacy fact URLs remain
reachable during this additive rollout; removing their existing free access is
an outstanding commercial migration, not completed work.

## Payment gates

`/v1/payments/coverage` exposes only configured integration coverage and explicit
blockers. Existing USDC/Base x402 receiving configuration is reused; its presence
does not prove owner wallet control or an actual transaction.

No authorized Payoneer API/consumer checkout, bank merchant gateway, push-to-card,
bank payout or FX adapter is connected. Payoneer business Payment Requests cannot
be repurposed as consumer-store checkout. Protection and deferred compute remain
disabled because approved terms, legal review, risk limits and funded reserves
are absent. No card numbers, CVV, PIN, bank credentials or owner account records
are requested or stored by this release.

Official references checked on 2026-11-08:

- https://payoneer.custhelp.com/app/answers/detail/a_id/12280
- https://www.payoneer.com/checkout/
- https://www.arabbank.com.jo/mainmenu/home/SMEs_Banking/digitalization-and-innovation/payment-gateway

## Release and rollback

The pre-change source is commit `c902e43265861375d33837c49def0f9ac5db2094`.
The remote rollback branch is `rollback/pre-global-route-20261108`.
The observed live Worker version was `e514abe7-f105-46a8-946e-29cbd0c849f5` with
tag `git-c902e4326586`. Configuration and all existing bindings are preserved.
No production database is exported or modified by preparing this source release.

Run the existing CI and guarded deployment pipeline. It snapshots the current
Worker, checks Durable Object compatibility, uploads a code-only canary, verifies
both old and new surfaces, and promotes only after successful checks. If a new
release fails, use the existing rollback procedure to the captured Worker version.
Code rollback preserves stored financial data; pending new task alarms pause on
old code and resume only when compatible network code returns. Do not advertise
continued execution while that code is rolled back.

## Outstanding scope

General AI planning, arbitrary provider adapters and secretless credentials;
global web search and registry ingestion; measured route ranking; accounts,
organizations and rotating scoped API keys; full customer and owner dashboards;
provider webhooks and delivery retry; multi-provider card and bank checkout;
FX, bank/card payouts and reconciliation; protected completion reserves; legally
approved deferred compute; external directory registrations; real independent
customer payment and verified owner settlement are not complete.
