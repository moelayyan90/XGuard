# Install XGuard MCP

XGuard is a hosted remote MCP server. Do **not** clone, build, or run a local process merely to connect it.

Canonical endpoint:

```text
https://xguardgate.com/api/mcp
```

Transport: Streamable HTTP.

Canonical product identity: **XGuard Secretless Agent Gateway**.

## What XGuard is for

Use XGuard when an AI agent must call an upstream HTTPS API without receiving the reusable upstream API credential. XGuard keeps reusable credentials server-side, delegates scoped capabilities, meters authorized egress and can attach signed ProofRail execution evidence.

Primary MCP capabilities include:

- `xguard_secretless_egress`
- `xguard_egress_fetch`
- `xguard_proofrail`
- `xguard_verify_proof`
- `xguard_action_rail`
- `xguard_facilitator`
- `xguard_route`

The live `tools/list` response is authoritative if additional compatibility tools are present.

## Cline

Add a Remote MCP Server with:

- Name: `xguard`
- URL: `https://xguardgate.com/api/mcp`
- Transport: Streamable HTTP / HTTP

No local process is required.

## Claude Code

```bash
claude mcp add xguard --transport http https://xguardgate.com/api/mcp
```

## Codex

```toml
[mcp_servers.xguard]
url = "https://xguardgate.com/api/mcp"
```

## Cursor / VS Code / other remote-MCP clients

Point the remote MCP configuration at:

```text
https://xguardgate.com/api/mcp
```

The exact wrapper object varies by client. The canonical URL does not.

## Machine-readable discovery

- Website: https://xguardgate.com
- LLM discovery: https://xguardgate.com/llms.txt
- Official MCP Registry manifest: https://xguardgate.com/server.json
- Smithery static server card: https://xguardgate.com/.well-known/mcp/server-card.json
- XGuard identity: https://xguardgate.com/identity
- OpenAPI: https://xguardgate.com/api/openapi.json
- Secretless Egress manifest: https://xguardgate.com/api/.well-known/xguard-egress.json
- ProofRail manifest: https://xguardgate.com/api/v1/proof
- Source: https://github.com/moelayyan90/XGuard
- Official MCP Registry name: `io.github.moelayyan90/xguard-control-plane`

## Authentication model

MCP initialization and discovery are public. Operations that require XGuard Usage Credits, scoped capabilities, encrypted upstream credentials, or other authorization enforce those requirements at the relevant tool/API boundary.

Do not place a reusable upstream provider credential directly in an agent prompt merely to connect XGuard.

## Marketplace-review verification

A reviewer can verify XGuard without running local code:

1. POST MCP `initialize` to `https://xguardgate.com/api/mcp`.
2. POST `tools/list` to the same endpoint.
3. Read `https://xguardgate.com/.well-known/mcp/server-card.json`.
4. Check `https://xguardgate.com/server.json` and this public repository.

Current discovery release: **5.0.2**.
