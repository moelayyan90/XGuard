# XGuard MCP installation

XGuard exposes a public remote Model Context Protocol server over Streamable HTTP.

## Endpoint

```text
https://xguardgate.com/mcp
```

## Generic remote MCP configuration

Use a remote MCP entry named `xguard` with transport `streamable-http` and the endpoint above. No local XGuard process, Docker image, API key, or package installation is required for the read-only MCP discovery tools.

The server currently exposes:

- `xguard_discover`
- `xguard_resource_details`
- `xguard_status`

## Expected verification

After connecting, issue `tools/list`. The client should discover the three tools above. Then call `xguard_status` to confirm the live XGuard service can be reached.

The MCP surface is read-only discovery. x402 settlement APIs are separate and require merchant onboarding/API credentials as documented in `QUICKSTART.md`.

## Canonical metadata

- Repository: https://github.com/moelayyan90/XGuard
- MCP Registry name: `io.github.moelayyan90/xguard`
- MCP transport: `streamable-http`
- MCP endpoint: https://xguardgate.com/mcp
- License: Apache-2.0
