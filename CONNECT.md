# Connect XGuard 5.1.0

XGuard turns public pages, product offers and RSS/Atom feeds into normalized results. Start with `xguard_execute {"intent":"demo"}` for a free extraction. The default MCP list contains `xguard_discover`, `xguard_execute` and `xguard_get_result`. Paid work returns signed prices in a 402 and requires your funded payer.

The compatibility identity remains XGuard Universal Paid AI Agent + Secretless Gateway; existing scoped credential APIs remain supported.

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
- Operators create encrypted credential records with `POST /v1/egress/credentials` and scoped capabilities with `POST /v1/egress/capabilities`.
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
