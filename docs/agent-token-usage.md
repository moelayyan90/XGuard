# Agent token usage ingestion — contract 1.0.0

`POST /v1/agent-token-usage/summary` records **self-reported telemetry**. It is not a query for an existing summary, a verified provider invoice, an execution request, or an x402-paid resource. No credits are consumed. Existing paid execution, Secretless Egress and ProofRail retain their accounting rules.

## Routing and root cause

Production version `7473739d-dd87-4bb1-b406-d4b646a4ce98` (git `2a546589e186`) routed this path through `apps/relay/src/canonical-entry.js` and the nested application stack to the terminal `not_found` in `index.js`. There was no handler, normalizer, or documented dependency contract for this endpoint. The supplied Java user-agent and AWS ASN identify neither a standard nor a caller contract. Source/dependency searches found no existing provider-specific contract to reproduce; this document defines XGuard's explicit ingestion compatibility contract.

The exact route is dispatched before the legacy stack on both `xguardgate.com` and `api.xguardgate.com`, preserving POST and its body. `/api/v1/...` continues to dispatch internally for POST. The canonical API host is preferred for clients. `www`/HTTP use the existing 308 policy. The relay Wrangler configuration has no zone routes: custom domains are managed separately and post-deployment verification checks both hosts. Do not add competing `/v1/*` zone routes without inspecting the domain bindings.

## Authentication and tenant binding

Supply a provisioned XGuard operator key as `Authorization: Bearer <key>` or `X-XGuard-Key: <key>`. If both are supplied, they must agree. The current billing `/v1/balance` authenticates the key; zero balance is accepted, restricted or unknown accounts are rejected. This is reuse of the existing identity system, not a payment charge. No JWT claims, capabilities without usage authority, client identity headers, payment signatures or query strings grant identity.

By default the tenant is `xgt_<SHA-256 of operator key>`. To support an external organization identifier, the **operator** configures `XGUARD_USAGE_TENANT_BINDINGS` in the relay environment as a JSON object mapping the SHA-256 hash of an already provisioned operator key to the verified organization ID. Example shape (placeholder hash, never a real secret):

```json
{"<64-lowercase-hex-key-hash>": "org_example"}
```

Validate organization ownership administratively before setting this binding. There is deliberately no public self-registration or first-claim-wins endpoint. Multiple provisioned keys may be bound to one verified organization and share usage/idempotency scope. Changing a binding changes that key's usage scope; plan migrations before rotating/moving keys.

Optional `tenantId`, `tenant_id`, `organizationId`, `organization_id`, `orgId`, and `org_id` in the query or body assert the authenticated tenant. Every supplied value must agree. Unknown organization IDs receive 403; no organization binding was inferred from the production log's `org_125646628718641154`. Without a provisioned identity callers receive 401 `tenant_identity_required`; if the identity service is down, a supplied key receives 503. This endpoint does not make an unprovisioned caller billable.

## Payload and limits

```json
{"inputTokens":100,"outputTokens":50,"totalTokens":150,"model":"model-name","agent":"agent-name","requestId":"event-001"}
```

Also accepted: `input_tokens`, `output_tokens`, `total_tokens`, `prompt_tokens`/`promptTokens`, `completion_tokens`/`completionTokens`, at the root or within `usage`. Unknown fields are ignored, not stored. Conflicting aliases and duplicate JSON property names are rejected. `model` and `agent` are optional root strings, 1–128 characters without controls.

Counts must be JSON integers from 0 to 1,000,000,000; strings, null, booleans, negative/fractional/non-finite values are rejected. At least one count is required. Missing total is the sum of supplied components. Total must cover their sum. Missing input/output remain `null` rather than fabricating a measured zero; monthly storage tracks incomplete breakdowns separately. Zero-token events are valid. Maximum body is 16,384 UTF-8 bytes, checked against both declared size and streamed bytes.

## Idempotency and storage

Supply `Idempotency-Key`, body `requestId`/`request_id`, or fallback `X-Request-ID`. At least one is required; identifiers are 1–200 ASCII letters/digits or `._:@/-`. Keep the same identifier and canonical payload across retries. If both Idempotency-Key and a body request ID are supplied, both are indexed. X-Request-ID is a transport trace when a stable event identifier exists; it does not change deduplication.

Existing `EGRESS_METER` / `EgressMeter` Durable Objects are partitioned by the resolved tenant's SHA-256 hash (`agent-usage-tenant:<hash>`). Event alias hashes, the canonical event, and monthly counts are written in a **single storage transaction**. Concurrent/restarted requests replay the original server request ID and return `duplicate:true`. Changed counts/model/agent or aliases that join two existing events return 409. Unknown fields do not change the fingerprint. Event IDs have no TTL and remain reserved while storage is retained. This avoids late retries becoming new usage. Canonical model/agent labels are stored: do not put secrets or personal content in them.

No new Durable Object class, migration, external database, or billing-worker deployment is needed. Existing global egress stats (`meter-v1`) and credit balances are untouched. There is no public usage-record lookup; operational inspection uses the existing Durable Object tooling. Durable Object transaction semantics: [Cloudflare storage documentation](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

## Abuse controls, CORS and errors

Durable admission limits are 120 requests/minute per Cloudflare source IP (before identity lookup), and per authenticated tenant. Unknown IPs share a bucket. Replays also count toward admission. Counters use one fixed storage key per object, not unbounded time-window keys. `429` provides `Retry-After`. Browser origins are restricted to the apex and API origins, POST/OPTIONS, and the documented auth/content/idempotency headers; cookies are not an authentication mechanism. Machine clients omit Origin.

Success returns `ok`, `accepted`, canonical `usage`, resolved `tenant`, server `request_id`, and `duplicate`. Rejections use the existing PublicError envelope and appropriate 400/401/403/405/409/413/429/500/503 status. Storage/identity failures never report success. Retry 429/503 with the same identifiers because a response failure can follow a durable commit. Terminal unknown API routes return 404 `unsupported_endpoint` with OpenAPI/MCP/capabilities recovery links; missing known resources retain their original 404.

Structured logs emit received/recorded/duplicate/rejected events with a server-generated request ID, source surface, safe tenant hash, token counts and rejection code. Authorization, key material, raw event IDs, query tenants, arbitrary bodies, and model/agent labels are never logged.

## Verification

```sh
node --test apps/relay/src/agent-token-usage-test.js scripts/verify-agent-token-usage-test.mjs
node scripts/verify-agent-token-usage.mjs
```

The production verifier sends an unauthenticated, incomplete event to each host and requires 401/403 `tenant_identity_required`, not merely any non-404. It also checks deployed OpenAPI and unknown-route recovery. It never writes usage. Set `EXPECTED_XGUARD_TAG=git-<12-character-commit>` to require the deployed version. A positive production ingestion test additionally needs a real authorized operator key and correct organization binding; neither is inferred or created by the verifier.
