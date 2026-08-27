# XGuard — Secretless Agent Gateway

## Listing identity

- **Name:** XGuard — Secretless Agent Gateway
- **Version:** 5.0.2
- **Category:** Security
- **Secondary categories:** Developer Tools, AI & ML, Cloud & DevOps
- **Pricing:** Usage-based service; public MCP discovery is available without account credentials. Credential provisioning and paid Secretless Egress are separate management/billing operations.
- **Website:** https://xguardgate.com
- **Source:** https://github.com/moelayyan90/XGuard
- **Remote MCP:** https://api.xguardgate.com/mcp
- **Transport:** Streamable HTTP
- **Official MCP Registry:** `io.github.moelayyan90/xguard-control-plane`

## Short description

Keep reusable API credentials outside AI-agent context. XGuard stores operator-controlled upstream credentials, delegates short-lived scoped capabilities to agents, injects credentials only at controlled server-side egress, meters authorized attempts, and can attach ProofRail ES256-signed execution evidence.

## What it solves

- Reusable API keys appearing in prompts, model context, agent memory, tool arguments, logs, or local configuration.
- Agents receiving credentials broader or longer-lived than the action they need to perform.
- Credential-backed actions that need independently verifiable execution evidence.
- Agent API egress that needs scope enforcement and per-attempt metering.

## Primary capabilities

1. **Secretless Egress** — operators retain reusable credentials inside XGuard and issue short-lived capabilities scoped by origin, path, HTTP method, lifetime, and call count.
2. **ProofRail** — authorized credential-backed outcomes can carry ES256-signed execution evidence without embedding the reusable upstream secret.
3. **Action Rail** — policy-gated execution controls for supported action flows.
4. **x402 compatibility** — facilitator discovery, routing, verification, settlement compatibility, and receipts remain available as supporting capabilities.

## Public discovery

- MCP: https://api.xguardgate.com/mcp
- MCP Registry manifest: https://xguardgate.com/server.json
- MCP server card: https://xguardgate.com/.well-known/mcp/server-card.json
- llms.txt: https://xguardgate.com/llms.txt
- OpenAPI: https://api.xguardgate.com/openapi.json
- Secretless Egress manifest: https://api.xguardgate.com/.well-known/xguard-egress.json
- ProofRail manifest: https://api.xguardgate.com/v1/proof

## Connect

### Claude Code

```bash
claude mcp add xguard --transport http https://api.xguardgate.com/mcp
```

### Codex

```toml
[mcp_servers.xguard]
url = "https://api.xguardgate.com/mcp"
```

### Cursor / VS Code / other remote-MCP clients

Use this Streamable HTTP URL:

```text
https://api.xguardgate.com/mcp
```

## Security boundary

Public MCP discovery is not the credential-management boundary. Reusable upstream credentials are provisioned through XGuard's authenticated management path. Agents are intended to receive scoped XGuard capabilities rather than reusable upstream secrets. XGuard does not claim that unrelated Internet traffic is forced through the service; it becomes the required credential-backed path only when an operator keeps the reusable upstream credential exclusively in XGuard and delegates capabilities instead.

## Suggested tags

`mcp`, `ai-agents`, `agent-security`, `api-security`, `secretless`, `credential-broker`, `egress`, `proofrail`, `developer-tools`, `x402`, `streamable-http`

## Suggested use cases

- Let an AI agent call GitHub, Stripe, OpenAI, Anthropic, or another HTTPS API without placing the reusable API key in the agent context.
- Give an autonomous workflow a short-lived capability that is narrower than the underlying credential.
- Produce signed evidence that an authorized credential-backed attempt passed through the expected XGuard execution boundary.
- Centralize metered, policy-checked agent egress while keeping reusable credentials server-side.

## Submission notes

XGuard is a hosted remote MCP server. Marketplace scanners should probe the canonical remote endpoint directly rather than requiring a local npm/PyPI install. The repository and machine-readable discovery documents are public for verification.
