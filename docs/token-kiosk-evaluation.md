# Token Kiosk Secretless Egress evaluation

Status: candidate integration, not deployed and not an authenticated vendor benchmark.

The `token_kiosk` provider preset pins server-side `Authorization: Bearer` injection
to `api-token-kiosk.gaib.ai`. The credential value belongs only in the existing
operator-authenticated credential provisioning API. Never put it in an agent
request, capability, URL, source file or log.

| Exact path | Allowed method |
| --- | --- |
| `/v1/chat/completions` | `POST` |
| `/v1/models` | `GET` |

Additional descendants, key-management endpoints and top-up endpoints are denied.
The existing custom-provider behavior is unchanged. Create a separate capability
for each endpoint/method pair; the Token Kiosk preset rejects a combined GET/POST
capability on one endpoint. Configure the provider API key with its own low spend
cap, short expiration and model allowlist using capabilities actually supported
by the provider account. XGuard Usage Credits are separate from vendor credit;
fixture billing in the tests does not fund a real operator account.

Example credential policy (operator-side, omit the secret from examples):

```json
{
  "provider": "token_kiosk",
  "label": "Token Kiosk isolated evaluation",
  "allowed_paths": ["/v1/chat/completions", "/v1/models"],
  "allowed_methods": ["POST", "GET"]
}
```

For chat, issue a capability with `target_origin` set to the pinned HTTPS origin,
`path_prefix: "/v1/chat/completions"`, `allowed_methods: ["POST"]`,
`ttl_seconds: 300`, and explicit low call/credit budgets. Add the credential value
only while provisioning through the trusted server-side secret path. Agents call
`POST /v1/egress/fetch` with this capability, an exact target, request body and a
fresh idempotency key for each distinct inference. An identical retry uses the
same idempotency key. Ambiguous outcomes must never receive a new retry key.

## Controlled verification

```sh
node --test apps/relay/src/egress-vault-test.js apps/relay/src/egress-execution-test.js apps/relay/src/token-kiosk-egress-test.js
```

The suite uses in-memory Durable Object fixtures, real encryption and real
ProofRail signing/verification, a synthetic upstream credential, and intercepted
network calls. No provider request, real billing or credit redemption occurs.
It checks host/path/method escape denial, header injection, credential-reflection
withholding (including split chunks), safe response headers, encrypted stored
results, log exclusion, cross-origin redirect handling, idempotency, timeout-error
redaction, response limits and preservation of upstream status/body semantics.

## Important current limits

- Egress buffers the complete body before returning it. SSE bytes can survive,
  including tool-call deltas, but this is **not incremental streaming**. A gated
  controlled test proves that the first bytes wait for stream completion.
- The response body limit is 49,152 bytes. A large model catalog, completion or
  SSE response can exceed it and become a durable ambiguous outcome.
- The upstream request uses a 30-second timeout. A slow completion can therefore
  become ambiguous. Neither the provider timeout nor provider-side billing after
  a disconnect has been validated in a funded benchmark.
- A successful controlled fixture is not proof of Token Kiosk model availability,
  tool-calling support, prices, accounting, rate limits, SLA or commercial rights.
- The production configuration uses `live-entry.js`. This candidate does not
  enable legacy egress routes in the production router or change that deployment.
  Its actual acceptance run needs a separately provisioned staging environment
  with the existing Durable Object, ProofRail and operator-billing bindings.

## Vendor acceptance gate

Production integration remains blocked until all of the following are verified:

1. Official authentication, free-credit redemption and provider-side key limits.
2. Server-to-server access to the documented API origin. If a WAF challenge or
   explicit client block occurs, stop and obtain vendor-supported access; do not
   change fingerprints, proxy through another host, or use a legacy hostname to
   bypass it.
3. Funded direct and isolated-XGuard trials, measured usage and wallet balance
   deltas, matching tool calls, semantic error checks and streaming assessment.
4. Written commercial/reseller terms, SLA, production rate limits and support.

No commercial acceptance or minimum spend is implied by this candidate.

## Primary references

- [API overview](https://token-kiosk.gaib.ai/docs/api/overview)
- [Chat completions](https://token-kiosk.gaib.ai/docs/api/chat-completions)
- [API key management](https://token-kiosk.gaib.ai/docs/api/api-keys)
- [Error semantics](https://token-kiosk.gaib.ai/docs/api/errors)
