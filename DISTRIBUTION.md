# Distribution

## Adoption surfaces

- `xguard init`: local AST-based migration with backup, changed-file/hash manifest, test execution, automatic failure rollback, and a production default of `https://xguardgate.com` unless an explicit gateway override is supplied.
- `xguard rollback`: hash-safe restoration that refuses to overwrite later user edits.
- `xguard doctor`: repository and public-endpoint diagnostics for x402 v2, facilitator configuration, Payment Identifier, duplicate risk, Bazaar metadata, reachability, security, and latency.
- `@xguard/sdk`: a minimal `FacilitatorClient`-compatible wrapper for resource servers plus hosted buyer-agent payment-decision integration.
- `examples/x402-xguard-starter`: Base mainnet Express x402 v2 resource example with Payment Identifier and Bazaar metadata; it requires explicit merchant credentials and a seller receiving address before it can start.
- `apps/mcp-example`: Base mainnet paid-tool reference integration using the MCP SDK and `@x402/mcp`; it also requires explicit merchant credentials and receiving address.
- `/discovery/resources`: public machine-readable Bazaar catalog.
- `/discovery/search`: bounded resource search for HTTP APIs and MCP tools.
- `/mcp`: remote stateless agent interface exposing payment-intent safety/evidence plus x402 discovery and status tools.
- `/.well-known/mcp/server.json`: remote MCP server metadata.
- `/.well-known/agent-card.json`: A2A discovery metadata exposing payment-decision, x402 discovery, migration, and settlement-truth skills.

The production adoption paths are:

```text
Buyer/AI agent payment intent
        -> XGuard MCP payment offer
        -> optional XGuard ALLOW / REVIEW / BLOCK decision + durable evidence
        -> external payment rail/provider executes the actual payment
```

and for merchant x402 settlement:

```text
AI agent -> paid API/MCP tool -> XGuard mainnet /verify + /settle -> settlement facilitator
                                      |
                                      +-> Bazaar catalog -> discovery API / XGuard MCP
```

The buyer-agent MCP decision surface does not claim to move the payer's money. It evaluates and records declared payment intent before the actual rail/provider executes the external payment. The merchant-facing x402 gateway separately provides facilitator-compatible verification and settlement routing.

The agent does not need a private XGuard integration when it is buying from a resource server that already uses XGuard as its x402 facilitator. The resource server owns the XGuard merchant credential and prepaid service balance.

## Remote MCP tool surface

The current modern MCP surface exposes five tools:

- `xguard_payment_offer` — free pre-payment offer; does not execute payment.
- `xguard_payment_decision` — authenticated idempotent ALLOW / REVIEW / BLOCK decision plus durable evidence; does not execute the external payment.
- `xguard_discover` — search/list XGuard's x402 resource catalog.
- `xguard_resource_details` — inspect one exact catalog resource.
- `xguard_status` — inspect live mainnet gateway and discovery status.

Directory and installer metadata must advertise this full tool surface. A manifest that advertises only discovery/status tools is stale and should fail the distribution quality gate.

## Package publication

The candidate npm names remain `xguard`, `@xguard/core`, and `@xguard/sdk`. They must not be described as npm-published until an authorized npm owner has bound trusted publishing and the packages are verifiably available in that registry.

Installable alpha tarballs are, however, published as a GitHub prerelease from protected `main`. GitHub Actions rebuilds them from the repository, verifies the release candidate, smoke-installs the CLI/SDK/Core locally, uploads the release assets with checksums, then reinstalls the CLI from the **public GitHub Release URL** and verifies that `xguard init` advertises the production mainnet gateway.

The public repository is [`moelayyan90/XGuard`](https://github.com/moelayyan90/XGuard). Public npm publication remains a separate authenticated release action and is not implied by the GitHub tarballs.

## Production publication sequence

1. Keep CI, CodeQL, secret scanning, protected-branch controls, and release verification green.
2. Merge only code that passes the relevant release checks.
3. Apply D1 migrations before the `xguard-mainnet` Worker deployment when migrations change.
4. Require live `/healthz`, `/readyz`, `/supported`, `/status`, provider/Glama discovery, Bazaar/OpenAPI, Agent Card, and remote MCP smoke checks after deployment.
5. Rebuild and publicly verify the GitHub prerelease package tarballs when package surfaces change.
6. Bind authorized npm trusted publishing before any npm prerelease/stable publication; do not claim npm availability before the registry proves it.
7. Keep official/third-party MCP and agent directory metadata pointed at `https://xguardgate.com/mcp`, advertise the full current tool surface, and record acceptance only after evidence exists.
8. Submit or refresh XGuard in relevant MCP, A2A, agent, and x402 ecosystem listings only with accurate capabilities, pricing, networks, and operational URLs.

Current directory/listing evidence is tracked in `.github/xguard-directory-status.json`. A queued, submitted, or locally prepared listing is not called “listed” until its evidence supports that status.

## Agent-discovery requirements

XGuard advertises the `bazaar` extension only because the mainnet edge implements cataloging itself. Eligible Bazaar metadata is validated before storage. MCP tools are keyed by resource URL plus tool name, while HTTP resources are keyed by canonical resource URL.

The remote MCP endpoint is non-custodial with respect to the payer's external money: it does not hold wallets, sign arbitrary external payments, fabricate settlements, or bypass the payment rail/provider. It is not discovery-only. It also exposes an explicit pre-payment offer and an authenticated payment-decision/evidence action for buyer agents.

Payment-intent descriptions should use terms agents actually match on — payment, pay, spend, pre-payment, payment safety, payment decision, payment coordination, settlement, x402, and evidence — while preserving the boundary that the MCP decision action itself does not execute the external payment.

## Listing quality gate

Every public URL and package must work; examples and migration must run; test and security status must be accurate; pricing and downstream costs must be distinct; machine schemas must be complete; no secret may be present; and availability history must contain measurements rather than claims.

Every distribution manifest, LLM installation guide, MCP registry record, Agent Card, skill file, and directory submission must agree on the current MCP version and advertise the live payment tools. Stale discovery-only metadata is treated as a distribution defect.

Submission or acceptance is never reported until it actually occurs.

XGuard is an independent payment-coordination, safety, routing, and facilitator gateway. It is not described as an official x402 Foundation facilitator, Coinbase product, or endorsed MCP Registry service unless such status is actually granted.

No scraping, fake accounts, fake reviews, fake stars, fake transactions, endorsement claims, or impersonation are part of distribution. Growth is driven by working integrations, accurate machine-readable discovery, low-friction SDK/CLI adoption, transparent health, and verifiable payment/settlement behavior.
