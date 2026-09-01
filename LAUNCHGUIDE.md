# XGuard — Universal Paid AI Agent + Secretless Gateway

## Listing identity

- **Name:** XGuard — Universal Paid AI Agent + Secretless Gateway
- **Version:** 5.1.0
- **Category:** Security
- **Secondary categories:** Developer Tools, AI & ML, Cloud & DevOps
- **Pricing:** Public discovery and signed quotes are free. Paid tools use x402 USDC per request with no account or subscription; operator-provisioned Secretless Egress remains a separate management surface.
- **Website:** https://xguardgate.com
- **Source:** https://github.com/moelayyan90/XGuard
- **Remote MCP:** https://api.xguardgate.com/mcp
- **Transport:** Streamable HTTP
- **Official MCP Registry:** `io.github.moelayyan90/xguard-control-plane`

## Short description

Discover a real tool and its signed price, pay once with x402 USDC, and receive a signed receipt plus ProofRail evidence. XGuard also keeps reusable operator-controlled upstream credentials outside AI-agent context and injects them only at controlled server-side egress.

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
- A2A Agent Card: https://xguardgate.com/.well-known/agent-card.json

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

Public MCP and A2A discovery are not the credential-management boundary. Reusable upstream credentials are provisioned through XGuard's authenticated management path. Agents are intended to receive scoped XGuard capabilities rather than reusable upstream secrets. XGuard does not claim that unrelated Internet traffic is forced through the service; it becomes the required credential-backed path only when an operator keeps the reusable upstream credential exclusively in XGuard and delegates capabilities instead.

The A2A surface is discovery-only: it does not provision credentials, consume XGuard Usage Credits, mutate accounts, or execute upstream side effects.

## Suggested tags

`mcp`, `a2a`, `ai-agents`, `agent-security`, `api-security`, `secretless`, `credential-broker`, `egress`, `proofrail`, `developer-tools`, `x402`, `streamable-http`

## Suggested use cases

- Let an AI agent call GitHub, Stripe, OpenAI, Anthropic, or another HTTPS API without placing the reusable API key in the agent context.
- Give an autonomous workflow a short-lived capability that is narrower than the underlying credential.
- Produce signed evidence that an authorized credential-backed attempt passed through the expected XGuard execution boundary.
- Let MCP and A2A discovery systems resolve XGuard's canonical public metadata without giving the discovery agent authority to execute credential-backed actions.

## Submission notes

XGuard is a hosted remote MCP server with a separate read-only A2A discovery agent. Marketplace scanners should probe the canonical remote endpoint directly rather than requiring a local npm/PyPI install. The repository and machine-readable discovery documents are public for verification.
