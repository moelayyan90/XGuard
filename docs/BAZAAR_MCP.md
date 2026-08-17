# Bazaar and MCP readiness

XGuard's production discovery surfaces are part of the live `xguard-mainnet` Worker. Bazaar cataloging and remote XGuard MCP discovery are implemented separately from settlement correctness: malformed or unavailable discovery metadata must not create a second financial submission.

## Production Bazaar surface

The mainnet edge can catalog eligible x402 resources carrying valid Bazaar metadata and exposes:

- `GET /discovery/resources`
- `GET /discovery/search`
- the `bazaar` extension only when support is actually measured/implemented

Agent-facing production metadata must state:

- XGuard is a hosted x402 safety/routing gateway rather than the direct on-chain signer when xpay submits settlement;
- production compatibility is x402 v2 `exact` on Base mainnet (`eip155:8453`) using native USDC;
- the XGuard service fee is `$0.002` per successful billable settlement after the earned-finality boundary;
- diagnostics/discovery and explicit testnet traffic are non-billable;
- unsupported, replay-conflict, in-progress, ambiguous, and insufficient-service-balance states fail explicitly;
- machine-discovery entries require complete bounded input/output metadata rather than invented capabilities.

## Production remote XGuard MCP

The live remote MCP endpoint is:

```text
https://xguard-mainnet.maqamapp.workers.dev/mcp
```

It exposes XGuard discovery/status tools and is intentionally read-only with respect to money. It does not hold merchant wallets, sign payments, create synthetic settlements, or bypass a resource server's x402 policy.

The production Worker publishes MCP metadata at `/.well-known/mcp/server.json`, is represented by the canonical `server.json` registry metadata, and is protected by the mainnet live smoke contract. ToolHive compatibility has also been exercised against the public remote endpoint and recorded in `docs/registry-submissions/toolhive/COMPATIBILITY.md`.

## Paid MCP resource example

`apps/mcp-example` is a separate seller-side reference integration using the MCP SDK plus `@x402/mcp`. It now defaults to the XGuard production gateway and Base mainnet, and refuses to start until an explicit XGuard merchant API key and non-zero Base mainnet receiving address are supplied.

The example's `safe_echo` tool advertises a `$0.001` seller payment. That seller price is separate from XGuard's `$0.002` successful-settlement service fee charged to the merchant's prepaid XGuard service balance.

The example uses local stdio transport, so its presence in the repository does not by itself make that seller tool a public remote MCP service. Public discovery of a seller tool still requires an appropriate deployed transport and valid discovery metadata. The example conditionally declares Bazaar metadata only when the selected facilitator route advertises Bazaar support.

## Optional testnet

Base Sepolia remains available only as an explicit non-billable integration-testing path. Testnet is not the default for the production XGuard gateway, CLI, starter examples, automatic deployment, or live monitoring.

No external listing or endorsement is claimed merely because metadata exists. Directory status is recorded only when evidence supports it in `.github/xguard-directory-status.json`.
