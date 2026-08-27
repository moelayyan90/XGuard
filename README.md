# XGuard — Secretless Agent Gateway

**Canonical production API**

```text
https://api.xguardgate.com
```

XGuard keeps reusable upstream credentials **out of AI agents**. Operators store a Stripe, GitHub, OpenAI, Anthropic, Slack, Notion, Cloudflare, Gemini or custom API credential once, then give the agent only a short-lived scoped XGuard capability.

```text
Operator secret
     ↓
Encrypted XGuard credential vault
     ↓
Scoped capability
     ↓
AI agent
     ↓
XGuard Secretless Egress
     ↓
credential injected server-side
     ↓
upstream API
```

The agent never receives the reusable upstream credential.

> XGuard becomes an actual choke point when an operator keeps the reusable credential only in XGuard and delegates capabilities instead of redistributing that credential. XGuard does not claim control over unrelated Internet traffic.

## Why Secretless Egress

A reusable bearer token inside an autonomous agent can be copied, logged, placed in context, reused outside the intended request or leaked to an untrusted tool. XGuard changes the primitive from **secret possession** to **scoped capability possession**.

The current egress boundary provides:

- encrypted reusable credential storage;
- provider presets for OpenAI, Anthropic, GitHub, Stripe, Slack, Notion, Cloudflare and Gemini;
- custom header-based credentials restricted to explicit public HTTPS hosts;
- short-lived capabilities;
- exact HTTPS origin binding;
- path-prefix allowlists;
- HTTP method allowlists;
- maximum call counts;
- Usage Credit billing before secret release and before outbound network egress;
- no automatic credential forwarding across redirects;
- private/local target blocking;
- automatic `Idempotency-Key` injection for unsafe methods;
- no blind automatic replay after network ambiguity;
- MCP discovery and egress execution without exposing credential provisioning to model context.

## Egress API

Machine-readable contract:

```text
GET https://api.xguardgate.com/v1/egress
GET https://api.xguardgate.com/.well-known/xguard-egress.json
GET https://api.xguardgate.com/.well-known/xguard-egress-key.json
GET https://api.xguardgate.com/v1/egress/providers
```

### 1. Operator stores a reusable credential

Credential provisioning is intentionally an **operator API**, not an MCP tool.

```http
POST /v1/egress/credentials
X-XGuard-Key: <usage-credit-key>
Content-Type: application/json
```

```json
{
  "provider": "github",
  "value": "<github-token>",
  "label": "production-github",
  "allowed_paths": ["/repos/"],
  "allowed_methods": ["GET", "POST"]
}
```

XGuard returns only credential metadata such as `xcred_...`; the reusable secret is not returned.

### 2. Operator issues a short capability

```http
POST /v1/egress/capabilities
X-XGuard-Key: <usage-credit-key>
Content-Type: application/json
```

```json
{
  "credential_id": "xcred_...",
  "target_origin": "https://api.github.com",
  "path_prefix": "/repos/",
  "allowed_methods": ["GET", "POST"],
  "ttl_seconds": 300,
  "max_calls": 10
}
```

The returned `xgc_...` capability is what the agent receives.

### 3. Agent executes without the upstream secret

```http
POST /v1/egress/fetch
Content-Type: application/json
```

```json
{
  "capability": "xgc_...",
  "target": "https://api.github.com/repos/org/repo/issues",
  "method": "POST",
  "body_json": {
    "title": "Example"
  }
}
```

XGuard validates capability scope and billing, injects the GitHub credential server-side, sends one HTTPS request and never exposes the reusable GitHub token to the agent.

Pricing contract:

```text
GET /v1/egress/pricing
```

The current configuration consumes **1 XGuard Usage Credit per authorized credential-backed egress attempt**. Billing is committed before credential decryption and before outbound network egress. If billing cannot commit, no upstream request is sent.

## MCP

Canonical MCP endpoint:

```text
https://api.xguardgate.com/mcp
```

Agent-facing tools include:

```text
xguard_secretless_egress
xguard_egress_fetch
xguard_action_rail
```

Reusable credential creation is deliberately **not** exposed as an MCP tool.

## Action Rail underneath

Secretless Egress is the primary product boundary. XGuard Action Rail remains available underneath for stronger execution controls around payments, purchases, bookings, messages, deployments, deletes, API writes and tool calls.

```text
POST /v1/mandates
POST /v1/actions/permits
POST /v1/actions/execute
GET  /v1/actions/permits/{permit_id}
```

Action Rail adds scoped mandates, request-bound cryptographic permits, replay rejection, durable execution state and receipts.

## Universal and Edge deployment

For operator-controlled infrastructure XGuard can also be placed in front of an origin:

```text
Internet / Ingress
      ↓
XGuard Universal Gate
      ↓
private origin
```

The repository includes Cloudflare Edge Gate, portable Node deployment, Docker, Docker Compose, Kubernetes and OpenAPI AutoGate components.

## Native x402 compatibility

x402 remains a compatibility rail, not the definition of XGuard.

```text
GET  /supported
POST /verify
POST /settle
GET  /facilitator
GET  /.well-known/x402
GET  /v1/facilitator/route
```

XGuard remains a non-custodial x402 v2 facilitator gateway with capability-aware routing, replay protection, Base USDC reconciliation and fail-closed ambiguous settlement behavior.

## Security model

- reusable upstream credentials are encrypted at rest using per-record AES-GCM keys wrapped by an XGuard RSA-OAEP authority;
- secret values are not included in agent capabilities;
- operator XGuard Usage Credit keys are encrypted into capability state and are not handed to agents;
- capabilities bind an origin, path prefix, methods, expiry and maximum calls;
- user-supplied headers cannot override the injected credential header or XGuard control headers;
- private/local targets and XGuard self-targets are blocked;
- redirects are not automatically followed with injected credentials;
- billing commits before secret decryption and network egress;
- unsafe methods receive an XGuard-generated `Idempotency-Key` when the caller did not supply one;
- XGuard does not automatically replay a credential-backed request after a network ambiguity.

## Machine discovery

```text
GET /.well-known/xguard-egress.json
GET /.well-known/xguard-actions.json
GET /.well-known/xguard.json
GET /.well-known/ai-plugin.json
GET /.well-known/agent-card.json
GET /architecture
GET /v1/protocols
GET /openapi.json
GET /llms.txt
GET /skill.md
GET /sitemap.xml
```

## Production domains

```text
https://xguardgate.com
https://api.xguardgate.com
```

The Cloudflare Worker configuration disables the public `workers.dev` route so XGuard's production identity is limited to the custom XGuard domains.

Repository:

```text
https://github.com/moelayyan90/XGuard
```
