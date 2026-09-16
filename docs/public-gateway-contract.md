# Public gateway contract

The Worker entry point is `apps/relay/src/canonical-entry.js`. Public outcome
requests reach `outcome-entry.js` and `outcome-catalog.js` before the compatible
single-page `web.fetch` handlers. Capability aliases must select this same route
for both quotes and execution. `/api/` POST aliases now follow that route too.

## Request and payment lifecycle

| Stage | Implementation and invariant |
| --- | --- |
| Discovery and prices | `liveOutcomes` uses the executable catalog and `gatewayConfig`; unavailable payment configurations are not advertised as live. |
| Input boundary | Bounded UTF-8 JSON, duplicate-key rejection, explicit tool aliases, and unambiguous envelopes. Quantity is exactly one bounded execution. |
| Quote | `issueQuote` signs capability, canonical input digest, price, asset, network, recipient, expiry and payment identifier. `next.body` is a public request, not the internal signed representation. |
| Payment requirement | A call without authorization returns the native x402 v2 402 envelope and its signed quote. It does not access the source. |
| Verification and settlement | Paid outcomes validate the quote, original authorization and durable reservation before calling the configured facilitator and performing source access. The separate compatibility `/settle` relay rebuilds trusted context per request; see `settlement-context.md`. |
| Execution | Existing bounded fetch, SSRF/DNS policy, secret isolation and provider handling remain enforced. |
| Receipt and recovery | The durable payment identifier plus original quote is the outcome idempotency contract. Identical paid retries return stored results; scoped vendor writes use `Idempotency-Key`. Preserve recovery before submission. |
| Telemetry | Normalization logs contain only fixed transformation labels and paths, never original signatures, credentials or input values. Synthetic probes do not establish commercial revenue. |

## Smallest useful calls

Free execution:

```sh
curl https://api.xguardgate.com/v1/execute \
  -H 'content-type: application/json' -d '{"intent":"demo"}'
```

Optional price preview for a real paid capability:

```sh
curl https://api.xguardgate.com/v1/pricing/quote \
  -H 'content-type: application/json' -d '{"tool_id":"feed-digest"}'
```

Send `next.body` to `next.execution_url` with the supplied quote header. A 402
challenge still requires a funded caller-owned x402 client. See the tested JS
SDK in `sdk/outcomes.js`, Python integration in `integrations/python`, and the
native MCP purchase test in `apps/relay/src/outcome-http-test.js`.

`tool`, `tool_id`, `toolId` and `name` accept actual capability IDs, optionally
prefixed with `xguard.`. `xguard_execute` wraps `input`, `arguments`, or a function
call with JSON-encoded arguments. Contradictory intent, source, quantity, network
or tool fields are rejected rather than resolved by precedence. Unsupported
requests are not translated into a different paid task.

## Errors and protocol compatibility

REST failures return `ok:false`, `error:{code,message,retryable,docs,...}`,
`error_code`, `request_id` and `next`. The body and header share the request ID.
Existing `reason`, `errorReason`, verification fields and repair details remain
available. Consumers which previously read an error string should read
`error.code` or `error_code`. The original payment authorization is never echoed.

Native x402 402 envelopes keep their specified shape, with additive `xguard_error`
guidance. MCP and A2A preserve JSON-RPC envelopes; MCP tool failures carry the
public error inside the tool result. OAuth discovery preserves its protocol
contract and does not invent an authorization server. Ambiguous payment outcomes
require reconciliation, not blind retries or a freshly signed purchase.

OpenAPI describes the public error schema and canonical aliases. `/openapi.yaml`
redirects to `/openapi.json`, keeping a single authoritative representation.
The agent directory links to the canonical card and runtime capability catalog.
Outcome price discovery includes the network, asset, recipient, billing unit,
expiry and exactly-one-execution quantity boundary.

## Verification boundaries

Local tests run real handlers over HTTP, exercise real signatures/quote/receipt
cryptography and isolate stateless settlement requests. Facilitators and source
responses are fixtures. Production deployment runs `verify-public-contract.mjs`
and `verify-settlement-context.mjs`; neither contains a valid funded payment.
These tests do not prove a real customer purchase or future profitability.

Primary protocol references:

- https://docs.x402.org/core-concepts/facilitator
- https://www.rfc-editor.org/rfc/rfc9728.html

## Concurrent compatibility settlement

The compatibility `/settle` route now reserves nonce-bearing authorizations in its
existing Durable Object after fresh verification. Concurrent identical requests
return either the confirmed receipt or `settlement_in_progress` with its receipt URL.
A lost confirmation response cannot cause a second broadcast. Only admission failures
before submission release the reservation. Unconfirmed Base USDC retries older than
two minutes reconcile onchain without resubmission; unresolved reservations stay
blocked. See `settlement-context.md` for the network and validity-window limits.
