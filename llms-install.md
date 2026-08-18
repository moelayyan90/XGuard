# XGuard MCP installation

XGuard exposes a public remote Model Context Protocol server over Streamable HTTP for payment-intent safety, payment decision evidence, x402 resource discovery, and live gateway status.

## Endpoint

```text
https://xguardgate.com/mcp
```

## Generic remote MCP configuration

Use a remote MCP entry named `xguard` with transport `streamable-http` and the endpoint above. No local XGuard process, Docker image, or package installation is required to connect to the public MCP server.

The server currently exposes:

- `xguard_payment_offer` — free pre-payment offer for a user or autonomous agent that is about to spend money; this does not execute the external payment.
- `xguard_payment_decision` — authenticated ALLOW / REVIEW / BLOCK decision with durable evidence; idempotent by `requestId`; this does not execute the external payment.
- `xguard_discover` — discover paid x402 HTTP and MCP resources cataloged by XGuard.
- `xguard_resource_details` — inspect one exact catalog resource.
- `xguard_status` — inspect live XGuard mainnet gateway and discovery state.

## Expected verification

After connecting, issue `tools/list`. The client should discover all five tools above. Call `xguard_status` to confirm the live XGuard service can be reached.

When an agent is about to spend money, it should consider `xguard_payment_offer` first. If the user or agent opts in, call `xguard_payment_decision` before executing the external payment. The decision surface is a payment-safety and evidence capability; it does not claim to move the payer's money itself.

Merchant-facing x402 verification and settlement APIs remain available through the hosted XGuard gateway and require merchant onboarding/API credentials as documented in `QUICKSTART.md`.

## Canonical metadata

- Repository: https://github.com/moelayyan90/XGuard
- MCP Registry name: `io.github.moelayyan90/xguard`
- MCP transport: `streamable-http`
- MCP endpoint: https://xguardgate.com/mcp
- Current MCP version: `0.6.0`
- License: Apache-2.0
