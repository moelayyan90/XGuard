# XGuard — Action Control Plane for AI Agents

**Canonical production API:**

```text
https://api.xguardgate.com
```

XGuard is a protocol-neutral execution control plane for AI side effects. It is designed for the moment an agent changes something outside itself: a payment, purchase, booking, message, deployment, delete, API write, tool call, or another irreversible action.

The core flow is:

```text
Agent intent
    ↓
Scoped XGuard Mandate
    ↓
Cryptographically signed Action Permit
    ↓
One request-bound execution
    ↓
Durable receipt / failed / ambiguous state
```

The Action Rail is deliberately positioned **inside the execution path**, not as an optional scanner beside it.

> XGuard becomes mandatory only for traffic an operator routes through the Action Rail, Universal Gate, or XGuard Edge. It does not claim the ability to force unrelated third-party Internet traffic through XGuard.

## Why Action Rail

AI systems increasingly call tools and APIs that create real-world side effects. XGuard adds an execution boundary with:

- scoped delegated mandates;
- merchant allowlists;
- action allowlists;
- per-action and daily budget limits;
- cryptographically signed permits;
- target, method, action, protocol, request-body and license binding;
- atomic single-use execution state;
- replay rejection;
- automatic `Idempotency-Key` injection when the target has none;
- expiry and revocation;
- fail-closed handling of ambiguous transport and HTTP 5xx outcomes;
- durable action receipts;
- Usage Credit billing only after known successful Action Rail execution.

## Action Rail API

Machine-readable manifest:

```text
GET https://api.xguardgate.com/v1/actions
GET https://api.xguardgate.com/.well-known/xguard-actions.json
GET https://api.xguardgate.com/.well-known/xguard-actions-key.json
```

Prepare an action:

```http
POST /v1/actions/permits
X-XGuard-Key: <usage-credit-license>
X-XGuard-Mandate: <scoped-mandate>
Content-Type: application/json
```

```json
{
  "target": "https://api.example.com/orders",
  "method": "POST",
  "action": "purchase",
  "protocol": "http",
  "amount_minor": "2500",
  "currency": "USD",
  "request_body": {
    "sku": "A-17",
    "quantity": 1
  }
}
```

XGuard returns a signed `xap_...` permit. Execute exactly that request once:

```http
POST /v1/actions/execute
X-XGuard-Key: <same-license>
Content-Type: application/json
```

```json
{
  "permit": { "...": "signed permit returned by XGuard" },
  "signature": "...",
  "headers": {
    "Authorization": "Bearer <upstream-credential>"
  },
  "request_body": {
    "sku": "A-17",
    "quantity": 1
  }
}
```

The permit is bound to the exact request-body digest. A second execution of the same permit is rejected by durable state.

Status lookup:

```text
GET /v1/actions/permits/{permit_id}
```

Pricing metadata and counters:

```text
GET /v1/actions/pricing
GET /v1/actions/stats
```

The current production configuration consumes **1 XGuard Usage Credit per known successful Action Rail execution**. Known failed and ambiguous Action Rail outcomes do not count as successful executions.

## Scoped mandates

Create a delegated authority envelope before preparing actions:

```text
POST /v1/mandates
GET  /v1/mandates/status
POST /v1/mandates/revoke
```

A mandate can constrain:

- `agent_id`;
- `currency`;
- maximum amount per action;
- daily authorized amount;
- maximum number of uses;
- merchant/domain allowlist;
- action allowlist;
- expiry;
- revocation.

Action classes can include `payment`, `purchase`, `booking`, `message`, `deploy`, `delete`, `create`, `update`, `tool_call`, or another explicit action label supported by the mandate.

## Protocol-neutral placement

The Action Rail executes ordinary public HTTPS targets and is not dependent on a single payment protocol.

XGuard's existing universal transaction edge also recognizes these surfaces:

```text
HTTP
MCP
x402
MPP
AP2
ACP
UCP
TAP
```

Recognition does not mean XGuard claims to implement every protocol's full payment stack. The Action Rail sits above the protocol-specific request as an authorization, execution and replay boundary.

## Universal Gate

For operator-controlled infrastructure, XGuard can sit directly in front of an existing origin:

```text
Internet / Ingress
      ↓
XGuard Universal Gate
      ↓
private origin
```

The repository ships:

- Cloudflare Edge Gate;
- portable Node server;
- Docker image build;
- Docker Compose topology;
- Kubernetes Deployment + Service topology;
- OpenAPI AutoGate for paid API routes.

See [`apps/universal-gate/README.md`](apps/universal-gate/README.md).

## XGuard Edge

A merchant can authorize XGuard Edge with DNS:

```dns
_xguard.example.com TXT "xguard-edge=enabled"
```

Then route agent-facing traffic through:

```text
https://api.xguardgate.com/edge/example.com/<path>
```

Private/local targets are blocked. XGuard inspects protocol and action shape, applies mandate enforcement for financial actions, forwards allowed traffic, and meters successful billable edge operations.

## Native x402 compatibility

x402 remains a supported compatibility product, but it no longer defines the whole platform.

```text
GET  /supported
POST /verify
POST /settle
GET  /facilitator
GET  /.well-known/x402
GET  /v1/facilitator/route
```

XGuard remains a non-custodial x402 v2 facilitator gateway with capability-aware routing, durable replay protection, Base USDC reconciliation and fail-closed ambiguous-settlement behavior. XGuard does not mutate the signed x402 recipient or payment amount.

## Existing settlement rail

The original signed settlement rail remains available for backward compatibility:

```text
GET  /v1/rail
POST /v1/rail/permits
POST /v1/rail/execute
```

New integrations should prefer the broader `/v1/actions/*` surface unless they specifically need the legacy settlement-oriented contract.

## MCP and machine discovery

Canonical remote MCP:

```text
https://api.xguardgate.com/mcp
```

The MCP tool list includes `xguard_action_rail` for Action Rail discovery in addition to facilitator, routing, inspection, safety and receipt tools.

Other machine-readable surfaces:

```text
GET /.well-known/xguard-actions.json
GET /.well-known/xguard.json
GET /.well-known/ai-plugin.json
GET /.well-known/agent-card.json
GET /architecture
GET /v1/protocols
GET /openapi.json
GET /llms.txt
GET /skill.md
```

## Security model

- no buyer or merchant private keys are required by the Action Rail;
- private/local execution targets are blocked;
- XGuard license keys are not embedded in the signed action permit; only their SHA-256 binding is stored in the permit;
- permit signatures use ECDSA P-256 / SHA-256;
- target, HTTP method, action, protocol, request digest, amount context and license binding are signed;
- permit state is durable and single-use;
- automatic replay is disabled after ambiguous outcomes;
- upstream authorization headers are forwarded only as part of the explicit action request and are not reused as XGuard billing credentials;
- XGuard billing uses the dedicated `X-XGuard-Key` header.

## Production domains

Production is exposed through the custom domains:

```text
https://xguardgate.com
https://api.xguardgate.com
```

The Cloudflare Worker configuration disables the public `workers.dev` route so XGuard's production identity does not depend on an unrelated account subdomain.

## Repository

```text
https://github.com/moelayyan90/XGuard
```

Website:

```text
https://xguardgate.com
```
