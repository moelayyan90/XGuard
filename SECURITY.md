# Security

Report vulnerabilities privately to `security@xguardgate.com`. Do not include production credentials, prompts, model outputs, payout destinations, or personal data in public issues.

## Trust boundaries

- DGrid or another approved network authenticates with `DGRID_PROVIDER_API_KEY`.
- Owner endpoints authenticate separately with `XGUARD_ADMIN_TOKEN`.
- Each upstream has a distinct API-key secret.
- `XGUARD_PAYOUT_DESTINATION` is readable only at runtime and is never returned.

Missing secrets fail closed. There is no unauthenticated inference fallback.

## Data minimization

XGuard does not store prompt text, message content, model output, upstream authorization headers, network credentials, client IP addresses, or payout destinations. D1 stores request hashes, one-way client hashes, model and provider identifiers, token counts, latency, status, cost, and revenue evidence references.

SSE accounting inspects only JSON usage frames; generated content is forwarded and discarded.

## Request controls

- 1 MiB request-body limit.
- Strict OpenAI-compatible message envelope validation.
- Per-client and global Cloudflare rate limits.
- Model-scoped Durable Object concurrency leases with expiry.
- Upstream timeout and bounded non-streaming response size.
- HTTPS-only upstream base URLs with optional exact hostname allowlist.
- Cloudflare `global_fetch_strictly_public` to reduce SSRF exposure.
- Retry only for transport, 429, and 5xx failures.

## Financial controls

- Integer micro-USD accounting.
- Profit guard includes upstream, network, and variable infrastructure cost before execution.
- Daily-loss circuit breaker.
- No active model without legal evidence, price, credential, and health.
- `PENDING` revenue excluded from settled revenue and profit.
- Automatic payout disabled while DGrid's provider payout contract is unpublished.

## Deployment controls

CI runs formatting, lint, strict type checking, Worker/D1 integration tests, invariant validation, secret scanning, and Wrangler dry build. Production deploy applies D1 migrations before Worker publication and verifies the canonical domain afterward.

Cloudflare invocation logs are sampled and must never log request bodies or secrets. The runtime contains no `console` calls.
