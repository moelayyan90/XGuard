# XGuard — Governed API Gateway

Scoped execution is a component of XGuard — Governed API Gateway.

[Mandatory governance](strict-governance.md) requires signed request authorization,
forecast economics and persistent stopping for every external scoped execution.
Legacy ungoverned capabilities are refused; migrate operator and agent callers
before deploying this source change.

Give agents capabilities, not reusable credentials.

An operator stores an encrypted provider credential and issues an expiring capability. The agent receives only that capability. XGuard validates the explicit operation, resource, origin, path, method, expiry, revocation and budgets; reserves an idempotent execution; commits credit consumption; then decrypts and injects the provider credential. The result is encrypted in durable storage and signed by ProofRail.

Canonical surfaces: [site](https://xguardgate.com), [API](https://api.xguardgate.com), [MCP](https://api.xguardgate.com/mcp), [A2A](https://api.xguardgate.com/a2a), [OpenAPI](https://api.xguardgate.com/openapi.json). The candidate product version is 6.0.0. Deployment must be verified before describing this candidate as live.

## Operator setup

Use `/operators` in the candidate site, or the existing operator-only `/v1/egress/credentials` and `/v1/egress/capabilities` APIs with a provisioned `X-XGuard-Key`. Provider credentials and operator keys must not appear in agent prompts. The hosted form keeps keys in memory, clears the provider input after storage, uses no browser persistence or third-party analytics, and displays the exact agent request before execution.

Choose an explicit `allowed_operations` list and `operation_limits.resources` allowlist, and supply the required `governance` policy with reviewed request-bound forecasts. Model capabilities also require `max_output_tokens`. Credential policies and capability scopes intersect; an operation grant cannot expand the underlying credential's origin/path/method limits. Raw egress cannot bypass governance or an operation-scoped capability. Legacy ungoverned grants are blocked.

`POST /v1/providers/plan` validates an operation and returns its derived scope without execution. `GET /v1/providers/operations` publishes all 16 schemas, permissions, classifications, billing boundaries and output contracts. Supported adapters are GitHub repository reads, issue creation/comments and draft pull requests; Cloudflare zone reads and filtered Worker metadata; Slack bounded history and channel messages; Notion page/database reads and limited page creation/title updates; bounded OpenAI, Anthropic and Gemini requests; Stripe customer reads. Cloudflare deployment and Stripe money movement are deliberately unavailable.

## Agent contract

First send the exact operation and stable key below to
`POST /v1/secretless/authorize`. Add the returned `authorization` as
`governance_authorization` to the same request before executing it. The ticket
expires after at most 30 seconds. The internal controlled demo is the only
capability flow without external execution and does not need a financial forecast.

```json
{
  "operation": "github.repository.read",
  "capability": "<operator-issued scoped capability>",
  "input": { "owner": "moelayyan90", "repo": "XGuard" },
  "idempotency_key": "read-xguard-repository-001"
}
```

Send this to `POST /v1/secretless/call`, `POST /v1/execute`, or MCP `xguard_secretless_call`. The eight primary MCP tools are `xguard_execute`, `xguard_secretless_call`, `xguard_preflight`, `xguard_quote`, `xguard_verify_receipt`, `xguard_discover`, `xguard_status`, and `xguard_get_result`. Existing raw-egress, Action Rail, ProofRail, paid fetch and x402 compatibility routes remain callable.

Operation IDs are explicit. Provider/action, tool/arguments and structured intent envelopes normalize to the same plan; conflicting fields, extra provider inputs, arbitrary headers, URL overrides and ambiguous writes are rejected. Natural-language public extraction intents retain their existing normalizer.

All mutations require a stable idempotency key. Concurrent identical requests reserve one attempt. Identical completed requests retrieve the stored result; changed input with the same key or a mismatched ticket is refused and halts the workload. Uncertain writes never automatically repeat. A revoked or expired capability cannot authorize a new call or result recovery; retain important receipts and proofs separately. Existing capability state is cleaned up 24 hours after expiry.

`xguard_preflight` and capability `xguard_quote` return an advisory authorization/budget snapshot without reservation, credit consumption or provider contact. They are not a balance guarantee or signed x402 offer. Public paid outcome quotes retain their signed x402 contract.

The response contains the provider result, execution identifier, request/result digests, billed credits, replay flag and proof. `xguard_verify_receipt` verifies the ProofRail signature and optional result digest; paid outcomes may also include a bound x402 receipt. The signature proves signed observations and byte integrity, not source truth.

## Free authenticated demo

`POST /v1/demo/secretless` creates a random server-side credential for an internal, authenticated, read-only fixture. It returns a two-minute, one-call capability, never the reusable credential. `/demo/secretless` runs the request, verifies scope denial, replays the durable result and verifies the real ES256 proof. The provider is an internal durable service, not an external vendor. Cost and billed credits are zero; its evidence explicitly says `demo:true` and `revenue:false`. Five grants per minute per IP and globally limit this controlled release demo.

The free public extraction preview remains available through `xguard_execute {"intent":"demo"}` and `/try`.

## Payments and recovery

New paid operations persist canonical lifecycle events alongside compatible financial states. Settlement has a durable reservation before `/settle`; verification or reservation commit failure blocks settlement. Successful settlement evidence must commit before an execution claim. A held execution claim is not silently reclaimed after timeout. Exact replay cannot settle again.

An ambiguous settlement becomes `RECONCILIATION_REQUIRED`. Alarms query read-only chain evidence and check both `AuthorizationUsed` and the exact token transfer in a successful receipt. They never resubmit `/settle`. The bounded lookup covers the latest 1,800 blocks or a previously observed transaction hash. Missing evidence stays unresolved, eventually requiring manual reconciliation; a consumed nonce alone is insufficient. Optional RPC fallbacks are read-only and explicitly configured.

Facilitator health records verify/settle success, latency, transport failures, invalid responses and ambiguous attempts over a bounded one-hour sample. Three consecutive transport/protocol failures open a 60-second circuit. Selection follows configured priority. Optional `XGUARD_PAID_FACILITATOR_FALLBACKS` must advertise the same x402 version, scheme and network. Selection is pinned before verification and never switches after reservation. Prices, treasury and recipient are unchanged.

## Observability and readiness

MCP initialize/list requests build responses locally without awaiting storage, RPC, billing or facilitators. Optional measurement is scheduled after the response. `/v1/status` shows a 24-hour window, success/failure counts by traffic class and latency percentiles based on the last 32 samples per hour per group. No samples means unknown, not 100% uptime.

`/healthz` reports component checks; `/v1/mcp/readiness`, `/v1/a2a/readiness`, `/v1/egress/readiness`, `/v1/payment/readiness`, `/v1/reconciliation/readiness` and `/v1/facilitators/health` expose the appropriate boundaries. Provider account permissions and operator balances are checked at execution, not promised by public readiness.

`GET /v1/operator/kpi` and `/v1/operator/events/{request_id}` require a separate server-configured `XGUARD_OPERATOR_METRICS_KEY` bearer secret. Configure it through the normal secret-management workflow; never commit a value. KPI responses distinguish settled cash, recognized revenue, unfulfilled liabilities, unique/repeat paying wallets and provider/MCP observations. Active-capability inventory excludes the controlled demo and marks historical coverage incomplete until old one-hour grants expire. Journey events are bounded, scrubbed and retained for 30 days; the financial operation ledger independently persists settlement truth. Health telemetry is not revenue.

## Provider references

Adapter routes and permissions were checked against provider-owned documentation: [GitHub issues](https://docs.github.com/en/rest/issues/issues), [GitHub pull requests](https://docs.github.com/en/rest/pulls/pulls), [Slack messages](https://docs.slack.dev/reference/methods/chat.postMessage/), [Notion databases](https://developers.notion.com/reference/retrieve-a-database), [Cloudflare Worker settings](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/methods/get/), [Gemini generation](https://ai.google.dev/api/generate-content), and [Stripe customer reads](https://docs.stripe.com/api/customers/retrieve). Provider credentials, scopes, model availability and account quotas remain operator-specific. Integration tests use controlled provider fixtures and do not establish live vendor acceptance.
