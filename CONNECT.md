# Connect XGuard 5.0.1

Canonical remote MCP endpoint:

```text
https://api.xguardgate.com/mcp
```

XGuard is a non-custodial x402 v2 facilitator and routing/safety layer. The remote MCP exposes facilitator identity, route selection, Bazaar discovery, transaction inspection, safety testing, live capabilities, health and durable receipt lookup.

## GitHub Copilot CLI

Install XGuard directly from the public repository:

```bash
copilot plugin install moelayyan90/XGuard
```

Or register the repository as a plugin marketplace and install the named plugin:

```bash
copilot plugin marketplace add moelayyan90/XGuard
copilot plugin install xguard-x402@xguard-plugins
```

The repository also ships `.mcp.json` for project-level MCP discovery.

## Claude Code

```bash
claude mcp add --transport http xguard https://api.xguardgate.com/mcp
claude mcp get xguard
```

The committed `.mcp.json` also makes the same remote server available as project configuration.

## Cursor

[Add XGuard to Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=xguard&config=eyJ4Z3VhcmQiOnsidXJsIjoiaHR0cHM6Ly9hcGkueGd1YXJkZ2F0ZS5jb20vbWNwIn19)

Project-native configuration is included at `.cursor/mcp.json`.

## Visual Studio Code / GitHub Copilot

[Install XGuard MCP in VS Code](vscode:mcp/install?%7B%22name%22%3A%22xguard%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fapi.xguardgate.com%2Fmcp%22%7D)

Workspace-native configuration is included at `.vscode/mcp.json`.

## Portable Agent Plugins

The repository root contains:

- `plugin.json` — Agent Plugins 1.0 manifest
- `mcp.json` — portable Streamable HTTP MCP configuration
- `.mcp.json` — Claude Code / GitHub Copilot project configuration
- `.cursor/mcp.json` — Cursor project configuration
- `.vscode/mcp.json` — VS Code project configuration

## Machine discovery

- Facilitator: https://api.xguardgate.com/facilitator
- OpenAPI: https://api.xguardgate.com/openapi.json
- LLM discovery: https://api.xguardgate.com/llms.txt
- x402 discovery: https://api.xguardgate.com/.well-known/x402
- Agent card: https://api.xguardgate.com/.well-known/agent-card.json
- AI plugin: https://api.xguardgate.com/.well-known/ai-plugin.json
- MCP metadata: https://api.xguardgate.com/.well-known/mcp/server.json
