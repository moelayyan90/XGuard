# Install XGuard MCP

XGuard is a hosted remote MCP server. Do **not** clone, build, or run a local process to connect it.

Canonical endpoint:

```text
https://api.xguardgate.com/mcp
```

Transport: Streamable HTTP.

No local environment variables are required for the public discovery/safety tool surface.

## Cline

In Cline, add a Remote MCP Server with:

- Name: `xguard`
- URL: `https://api.xguardgate.com/mcp`
- Transport: Streamable HTTP / HTTP

After connecting, verify the server exposes these 10 tools:

- `xguard_facilitator`
- `xguard_route`
- `xguard_discovery_search`
- `xguard_safety_test`
- `xguard_protocols`
- `xguard_inspect`
- `xguard_health`
- `xguard_supported`
- `xguard_receipt`
- `xguard_integration`

A successful MCP initialize response identifies the server as `xguard-high-velocity-x402-facilitator` version `5.0.1`.

## Other clients

Claude Code:

```bash
claude mcp add --transport http xguard https://api.xguardgate.com/mcp
```

GitHub Copilot CLI:

```bash
copilot plugin install moelayyan90/XGuard
```

Cursor and VS Code native project configs are included in `.cursor/mcp.json` and `.vscode/mcp.json`.

## Verification

Machine-readable metadata:

- OpenAPI: https://api.xguardgate.com/openapi.json
- x402: https://api.xguardgate.com/.well-known/x402
- Agent card: https://api.xguardgate.com/.well-known/agent-card.json
- MCP metadata: https://api.xguardgate.com/.well-known/mcp/server.json
- Status: https://api.xguardgate.com/status

XGuard is non-custodial. Do not attribute downstream facilitator signer or settlement addresses to XGuard itself.
