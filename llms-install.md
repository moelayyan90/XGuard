# Install XGuard MCP

Start with `xguard_execute {"intent":"demo"}` for a free, real extraction. The primary tools are `xguard_discover`, `xguard_execute`, and `xguard_get_result`. Live pages, product offers and feed digests have an exact USDC price before execution. A funded x402 payer is required for paid work.
Read https://api.xguardgate.com/agent.txt . Legacy explicit tools below are compatibility references, not the default catalog.


XGuard is a hosted remote MCP server. Do **not** clone, build, or run a local process merely to connect it.

Canonical endpoint:

```text
https://api.xguardgate.com/mcp
```

Transport: Streamable HTTP.

Canonical product identity: **XGuard Universal Paid AI Agent + Secretless Gateway**.

## What XGuard is for

Use XGuard when an AI agent needs a no-account paid tool or must call an upstream HTTPS API without receiving the reusable credential. XGuard signs prices, settles x402 v2 USDC before execution, makes retries idempotent and returns signed receipts plus ProofRail evidence.

Primary MCP capabilities include:

- `xguard.capabilities`
- `xguard.preflight` (free target-safety/payment-readiness gate; target is not contacted)
- `xguard.pricing.quote`
- `xguard.web.fetch`
- `xguard_secretless_egress`
- `xguard_egress_fetch`
- `xguard_proofrail`
- `xguard_verify_proof`
- `xguard_action_rail`
- `xguard_facilitator`
- `xguard_route`

The live `tools/list` response is authoritative if additional compatibility tools are present.

Recommended paid path: call `xguard.web.fetch` directly, inspect the signed quote and payment challenge, then use a funded compatible x402 v2 payer to retry the identical request with `Payment-Signature`. Preflight and standalone quoting are optional. Execution starts only after settlement. MCP editor installation alone does not provide a wallet or authorize payment.

Public quickstart and ready-to-merge editor configuration downloads: https://xguardgate.com/developers

## Cline

Add a Remote MCP Server with:

- Name: `xguard`
- URL: `https://api.xguardgate.com/mcp`
- Transport: Streamable HTTP / HTTP

No local process is required.

## Claude Code

```bash
claude mcp add xguard --transport http https://api.xguardgate.com/mcp
```

## Codex

```toml
[mcp_servers.xguard]
url = "https://api.xguardgate.com/mcp"
```

## Cursor / VS Code / other remote-MCP clients

Point the remote MCP configuration at:

```text
https://api.xguardgate.com/mcp
```

Download exact wrappers from [the developer quickstart](https://xguardgate.com/developers): Cursor uses `mcpServers`; VS Code uses `servers` with `type: "http"`; Claude Code uses `mcpServers` with `type: "http"`. Merge into your existing configuration.

## Machine-readable discovery

- Website: https://xguardgate.com
- LLM discovery: https://xguardgate.com/llms.txt
- Official MCP Registry manifest: https://xguardgate.com/server.json
- Smithery static server card: https://xguardgate.com/.well-known/mcp/server-card.json
- XGuard identity: https://xguardgate.com/identity
- OpenAPI: https://api.xguardgate.com/openapi.json
- Guarded preflight: https://api.xguardgate.com/v1/preflight
- Secretless Egress manifest: https://api.xguardgate.com/.well-known/xguard-egress.json
- ProofRail manifest: https://api.xguardgate.com/v1/proof
- Source: https://github.com/moelayyan90/XGuard
- Official MCP Registry name: `io.github.moelayyan90/xguard-control-plane`

## Authentication model

MCP initialization and discovery are public. Operations that require XGuard Usage Credits, scoped capabilities, encrypted upstream credentials, or other authorization enforce those requirements at the relevant tool/API boundary.

Do not place a reusable upstream provider credential directly in an agent prompt merely to connect XGuard.

## Marketplace-review verification

A reviewer can verify XGuard without running local code:

1. POST MCP `initialize` to `https://api.xguardgate.com/mcp`.
2. POST `tools/list` to the same endpoint.
3. Read `https://xguardgate.com/.well-known/mcp/server-card.json`.
4. Check `https://xguardgate.com/server.json` and this public repository.

Current discovery release: **5.1.0**.
