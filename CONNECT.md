# Connect XGuard 5.0.2

XGuard Secretless Agent Gateway keeps reusable upstream API credentials outside AI-agent context. Operators provision encrypted credentials and short-lived scoped capabilities; agents use those capabilities through controlled Secretless Egress. ProofRail can attach signed execution evidence. Action Rail and the x402 facilitator remain compatibility surfaces.

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

## Operator and agent separation

- Operators create encrypted credential records with `POST /v1/egress/credentials` and scoped capabilities with `POST /v1/egress/capabilities`.
- Credential provisioning is intentionally not an MCP tool.
- Agents call `POST /v1/egress/fetch` or MCP tool `xguard_egress_fetch` with a scoped capability, never the reusable upstream credential.

## Machine discovery

- Secretless Egress: https://api.xguardgate.com/v1/egress
- OpenAPI: https://api.xguardgate.com/openapi.json
- MCP: https://api.xguardgate.com/mcp
- LLM discovery: https://xguardgate.com/llms.txt
- Agent card: https://api.xguardgate.com/.well-known/agent-card.json
- AI plugin: https://api.xguardgate.com/.well-known/ai-plugin.json
- ProofRail: https://api.xguardgate.com/v1/proof
- x402 compatibility: https://api.xguardgate.com/facilitator
