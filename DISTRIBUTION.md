# Distribution

## Adoption surfaces

- `xguard init`: local AST-based migration with backup, changed-file/hash manifest, test execution, automatic failure rollback, and a production default of `https://xguardgate.com` unless an explicit gateway override is supplied.
- `xguard rollback`: hash-safe restoration that refuses to overwrite later user edits.
- `xguard doctor`: repository and public-endpoint diagnostics for x402 v2, facilitator configuration, Payment Identifier, duplicate risk, Bazaar metadata, reachability, security, and latency.
- `@xguard/sdk`: a minimal `FacilitatorClient`-compatible wrapper for resource servers.
- `examples/x402-xguard-starter`: Base mainnet Express x402 v2 resource example with Payment Identifier and Bazaar metadata; it requires explicit merchant credentials and a seller receiving address before it can start.
- `apps/mcp-example`: Base mainnet paid-tool reference integration using the MCP SDK and `@x402/mcp`; it also requires explicit merchant credentials and receiving address.
- `/discovery/resources`: public machine-readable Bazaar catalog.
- `/discovery/search`: bounded resource search for HTTP APIs and MCP tools.
- `/mcp`: remote stateless agent interface exposing XGuard discovery tools.
- `/.well-known/mcp/server.json`: remote MCP server metadata.

The production adoption path is:

```text
AI agent -> paid API/MCP tool -> XGuard mainnet /verify + /settle -> settlement facilitator
                                      |
                                      +-> Bazaar catalog -> discovery API / XGuard MCP
```

The agent does not need a private XGuard integration when it is buying from a resource server that already uses XGuard as its x402 facilitator. The resource server owns the XGuard merchant credential and prepaid service balance.

## Package publication

The candidate npm names remain `xguard`, `@xguard/core`, and `@xguard/sdk`. They must not be described as npm-published until an authorized npm owner has bound trusted publishing and the packages are verifiably available in that registry.

Installable alpha tarballs are, however, published as a GitHub prerelease from protected `main`. GitHub Actions rebuilds them from the repository, verifies the release candidate, smoke-installs the CLI/SDK/Core locally, uploads the release assets with checksums, then reinstalls the CLI from the **public GitHub Release URL** and verifies that `xguard init` advertises the production mainnet gateway.

The public repository is [`moelayyan90/XGuard`](https://github.com/moelayyan90/XGuard). Public npm publication remains a separate authenticated release action and is not implied by the GitHub tarballs.

## Production publication sequence

1. Keep CI, CodeQL, secret scanning, protected-branch controls, and release verification green.
2. Merge only code that passes `npm run verify:release`.
3. Apply D1 migrations before the `xguard-mainnet` Worker deployment.
4. Require live `/healthz`, `/readyz`, `/supported`, `/status`, provider/Glama discovery, Bazaar/OpenAPI, and remote MCP smoke checks after deployment.
5. Rebuild and publicly verify the GitHub prerelease package tarballs when package surfaces change.
6. Bind authorized npm trusted publishing before any npm prerelease/stable publication; do not claim npm availability before the registry proves it.
7. Keep official/third-party MCP and agent directory metadata pointed at `https://xguardgate.com/mcp` and record acceptance only after evidence exists.
8. Submit XGuard to relevant x402 ecosystem/facilitator listings only with accurate capabilities, pricing, networks, and operational URLs.

Current directory/listing evidence is tracked in `.github/xguard-directory-status.json`. A queued, submitted, or locally prepared listing is not called “listed” until its evidence supports that status.

## Agent-discovery requirements

XGuard advertises the `bazaar` extension only because the mainnet edge implements cataloging itself. Eligible Bazaar metadata is validated before storage. MCP tools are keyed by resource URL plus tool name, while HTTP resources are keyed by canonical resource URL.

The remote MCP endpoint is intentionally read-only with respect to money. Its tools discover cataloged paid resources and report XGuard status; it does not hold wallets, sign payments, create synthetic settlements, or bypass the x402 resource server's payment policy.

## Listing quality gate

Every public URL and package must work; examples and migration must run; test and security status must be accurate; pricing and downstream costs must be distinct; machine schemas must be complete; no secret may be present; and availability history must contain measurements rather than claims. Submission or acceptance is never reported until it actually occurs.

XGuard is an independent routing/facilitator gateway. It is not described as an official x402 Foundation facilitator, Coinbase product, or endorsed MCP Registry service unless such status is actually granted.

No scraping, fake accounts, fake reviews, fake stars, fake transactions, endorsement claims, or impersonation are part of distribution. Growth is driven by working integrations, machine-readable discovery, low-friction SDK/CLI adoption, transparent health, and verifiable settlement behavior.
