# Connect XGuard 6.0.0

XGuard — Governed API Gateway. Give agents capabilities, not reusable credentials.

Discovery is public and stateless. The primary tools are `xguard_execute`,
`xguard_secretless_call`, `xguard_preflight`, `xguard_quote`,
`xguard_verify_receipt`, `xguard_discover`, `xguard_status` and `xguard_get_result`.

An operator stores a provider credential and issues a scoped capability. An agent
calls `xguard_secretless_call` with that capability, an explicit operation, input
and stable idempotency key. See [the execution guide](docs/execution-gateway.md).
Operator and provider keys must never appear in MCP arguments.

Start without credentials using `xguard_execute {"intent":"demo"}` for a free
public extraction. The separate `/demo/secretless` page runs a real authenticated
internal service using a freshly issued, restricted capability.

Paid public outcomes retain signed prices and require a funded payer. HTTP uses
402; native MCP returns `isError` with PaymentRequired in both content forms.
An official x402 MCP client retries the same arguments with
`params._meta["x402/payment"]`, preserving challenge extensions. An MCP installation
does not supply a wallet. This branch is a candidate until deployment is verified.

Canonical remote MCP endpoint:

```text
https://api.xguardgate.com/mcp
```

## Claude Code

```bash
claude mcp add xguard --transport http https://api.xguardgate.com/mcp
claude mcp get xguard
```

## Codex

```toml
[mcp_servers.xguard]
url = "https://api.xguardgate.com/mcp"
```

## Cursor and VS Code

Configure a remote Streamable HTTP MCP server named `xguard` with URL `https://api.xguardgate.com/mcp`. Project-native examples are committed in `.cursor/mcp.json` and `.vscode/mcp.json`.

## Advanced compatibility routes

These older tools remain explicitly callable; they are not in the default catalog.

- Any agent can call `xguard.capabilities` and the free `xguard.preflight` guard, request `xguard.pricing.quote`, then invoke `xguard.web.fetch` after the mandatory x402 settlement.
- Operators create encrypted credential records with `POST /v1/egress/credentials` and scoped capabilities with a required `governance` policy at `POST /v1/egress/capabilities`. Before every external operation, obtain a signed ticket from `/v1/secretless/authorize` (or `/v1/egress/authorize` for raw requests) and include it as `governance_authorization`. Legacy grants without the policy are refused.
- Credential provisioning is intentionally not an MCP tool.
- Agents call `POST /v1/egress/fetch` or MCP tool `xguard_egress_fetch` with a scoped capability, never the reusable upstream credential.

## Machine discovery

- Actual capabilities: https://api.xguardgate.com/v1/capabilities
- Guarded preflight: https://api.xguardgate.com/v1/preflight
- Published pricing: https://api.xguardgate.com/v1/pricing
- x402 payment manifest: https://api.xguardgate.com/.well-known/payment-manifest
- Secretless Egress: https://api.xguardgate.com/v1/egress
- OpenAPI: https://api.xguardgate.com/openapi.json
- MCP: https://api.xguardgate.com/mcp
- LLM discovery: https://xguardgate.com/llms.txt
- Agent card: https://api.xguardgate.com/.well-known/agent-card.json
- AI plugin: https://api.xguardgate.com/.well-known/ai-plugin.json
- ProofRail: https://api.xguardgate.com/v1/proof
- x402 compatibility: https://api.xguardgate.com/facilitator
