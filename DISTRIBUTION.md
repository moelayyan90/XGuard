# Distribution

## Prepared adoption surfaces

- `xguard init`: local AST-based migration with backup, changed-file/hash manifest, test execution, automatic failure rollback, and no disclosure of an old credential-bearing URL.
- `xguard rollback`: hash-safe restoration that refuses to overwrite later user edits.
- `xguard doctor`: repository and public-endpoint diagnostics for x402 v2, facilitator configuration, Payment Identifier, duplicate risk, Bazaar metadata, reachability, security, and latency.
- `@xguard/sdk`: a minimal official `FacilitatorClient`-compatible wrapper.
- `examples/x402-xguard-starter`: Express x402 v2 resource with Payment Identifier and Bazaar metadata enabled only when the selected facilitator advertises Bazaar.
- `apps/mcp-example`: official MCP SDK plus official `@x402/mcp` paid-tool wrapper.
- public read-only compatibility checker and status endpoint in the gateway.

The manifests use the candidate names `xguard`, `@xguard/core`, and `@xguard/sdk`. No package is published or reserved, and registry search is not a substitute for ownership; an authorized publisher must re-check and claim the names at publication time or apply the documented scoped rename consistently.

The public repository is [`moelayyan90/XGuard`](https://github.com/moelayyan90/XGuard). CI and CodeQL pass; `main` is protected by pull-request, up-to-date `verify`, conversation-resolution, CodeQL, deletion, and force-push rules. Dependabot, secret scanning/push protection, and private vulnerability reporting are enabled. Its release workflow runs the full release verification, creates the three npm tarballs, and retains them as GitHub artifacts without publishing. Public npm publication stays intentionally separate until package ownership, npm authentication, and trusted-publisher configuration are proven.

## Legitimate publication sequence

1. Keep the working testnet URL green and run `npm run verify:release` plus `npm run smoke:live`.
2. Keep the active CI, CodeQL, protected-branch, Dependabot, secret-scanning/push-protection, and private-vulnerability-reporting controls green.
3. After an authorized npm owner binds trusted publishing to this repository, add a reviewed publish job and publish provenance-enabled prerelease packages with the `next` tag only.
4. Verify a fresh `npx xguard@latest init`, `doctor`, starter install, rollback, health, status, pricing, and security links.
5. Expose eligible paid-resource/MCP Bazaar metadata through a facilitator that supports current cataloging.
6. Submit accurate ecosystem, developer-tool, extension, facilitator, or MCP listings through their official contribution mechanism only where XGuard actually qualifies.

XGuard is presently best described as a routing facilitator/gateway, not an official Foundation facilitator and not a Coinbase product. The safety layer has not been submitted as a formal x402 extension because its core guarantees are server-side orchestration; a future protocol extension is warranted only when interoperability requires signed cross-party fields.

## Listing quality gate

Every URL and package must work; examples and migration must run; test and security status must be accurate; pricing and downstream costs must be distinct; machine schemas must be complete; no secret may be present; and availability history must contain measurements rather than claims. Submission or acceptance is never reported until it actually occurs.

No scraping, unsolicited bulk outreach, fake accounts, reviews, stars, transactions, endorsement, or impersonation is permitted. Growth comes from useful diagnostics, small integration changes, examples, protocol discovery, transparent health, and strong documentation.
