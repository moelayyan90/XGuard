# Distribution

## Adoption surfaces

- `xguard init`: local AST-based migration with backup, changed-file/hash manifest, test execution, automatic failure rollback, and no disclosure of an old credential-bearing URL.
- `xguard rollback`: hash-safe restoration that refuses to overwrite later user edits.
- `xguard doctor`: repository and public-endpoint diagnostics for x402 v2, facilitator configuration, Payment Identifier, duplicate risk, Bazaar metadata, reachability, security, and latency.
- `@xguard/sdk`: a minimal `FacilitatorClient`-compatible wrapper for resource servers.
- `examples/x402-xguard-starter`: Express x402 v2 resource example with Payment Identifier and Bazaar metadata.
- `apps/mcp-example`: paid-tool reference integration using the MCP SDK and `@x402/mcp`.
- `/discovery/resources`: public machine-readable Bazaar catalog.
- `/discovery/search`: bounded resource search for HTTP APIs and MCP tools.
- `/mcp`: remote stateless agent interface exposing XGuard discovery tools.
- `/.well-known/mcp/server.json`: remote MCP server metadata.

The mainnet adoption path is:

```text
AI agent -> paid API/MCP tool -> XGuard /verify + /settle -> settlement facilitator
                                      |
                                      +-> Bazaar catalog -> discovery API / XGuard MCP
```

The agent does not need a private XGuard integration when it is buying from a resource server that already uses XGuard as its x402 facilitator. The resource server owns the XGuard merchant credential and prepaid service balance.

## Package publication

The manifests use the candidate names `xguard`, `@xguard/core`, and `@xguard/sdk`. These names must not be described as published until an authorized npm owner has bound trusted publishing and the packages are verifiably available in the registry.

The public repository is [`moelayyan90/XGuard`](https://github.com/moelayyan90/XGuard). Release verification builds the package tarballs and validates the Worker bundles. Public npm publication remains a separate authenticated release action.

## Publication sequence

1. Keep CI, CodeQL, secret scanning, protected-branch controls, and release verification green.
2. Merge only code that passes `npm run verify:release`.
3. Apply D1 migrations before the mainnet Worker deployment.
4. Require live `/healthz`, `/readyz`, `/supported`, `/status`, Bazaar discovery, and remote MCP smoke checks after deployment.
5. Bind authorized npm trusted publishing, then publish provenance-enabled prerelease packages before promoting a stable tag.
6. Verify a clean external install of `xguard`, `@xguard/sdk`, the starter, `init`, `doctor`, and rollback.
7. Publish the verified MCP server metadata through the official MCP Registry mechanism only after the remote `/mcp` endpoint is live.
8. Submit XGuard to relevant x402 ecosystem/facilitator listings only with accurate capabilities, pricing, networks, and operational URLs.

## Agent-discovery requirements

XGuard advertises the `bazaar` extension only because the mainnet edge implements cataloging itself. Eligible Bazaar metadata is validated before storage. MCP tools are keyed by resource URL plus tool name, while HTTP resources are keyed by canonical resource URL.

The remote MCP endpoint is intentionally read-only with respect to money. Its tools discover cataloged paid resources and report XGuard status; it does not hold wallets, sign payments, or bypass the x402 resource server's payment policy.

## Listing quality gate

Every public URL and package must work; examples and migration must run; test and security status must be accurate; pricing and downstream costs must be distinct; machine schemas must be complete; no secret may be present; and availability history must contain measurements rather than claims. Submission or acceptance is never reported until it actually occurs.

XGuard is an independent routing/facilitator gateway. It is not described as an official x402 Foundation facilitator, Coinbase product, or endorsed MCP Registry service unless such status is actually granted.

No scraping, fake accounts, fake reviews, fake stars, fake transactions, endorsement claims, or impersonation are part of distribution. Growth is driven by working integrations, machine-readable discovery, low-friction SDK/CLI adoption, transparent health, and verifiable settlement behavior.
