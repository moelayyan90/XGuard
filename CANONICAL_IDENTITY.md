# XGuard canonical product identity

**Name:** XGuard — Governed API Gateway

**Product:** Governed API Gateway

**Source version metadata:** 6.0.0. The mandatory authorization flow requires client migration. A source change is not evidence of deployment.

**Canonical website:** https://xguardgate.com

**Canonical API:** https://api.xguardgate.com

**Canonical MCP:** https://api.xguardgate.com/mcp

**Registry identifier:** `io.github.moelayyan90/xguard-control-plane` (stable compatibility identifier).

XGuard governs agent API access with scoped authorization, server-side credentials,
spending limits and signed evidence. It also monetizes approved seller APIs with
explicit prices and owner-authorized payments.

## Product components and their boundaries

| Component | Actual behavior |
| --- | --- |
| Scoped execution | Provider secrets stay at the gateway; capabilities limit requests and credits. |
| Mandatory governance | Every external scoped execution requires an operator policy, signed request authorization, positive forecast net value, durable stopping and daily exposure accounting. Legacy ungoverned grants are refused. |
| Paid API Gateway | Seller catalog, exact prices, authorized x402 payments, delivery evidence and seller proceeds. |
| ProofRail | Signs observed execution facts and byte digests; does not prove source truth or profitability. |
| Compatibility rails | Stable MCP/A2A and SDK identifiers remain; external scoped callers must adopt the required ticket flow. Public outcomes, Action Rail and x402 have their own payment contracts. |

Legacy grants cannot run external scoped operations without reviewed replacement
policies. Public discovery remains free, and the internal demo cannot contact an
external provider. The operator must isolate the integrated agent/workload;
this source change does not force unrelated agents to use or pay XGuard.

## Claims that must not be made

- Guaranteed daily profits, maximum possible ROI, proven arbitrage demand, or revenue inferred from forecasts.
- Universal interception using a Python Singleton alone, or installed network isolation without deployment evidence.
- Instant rollback/cancellation of side effects already accepted by an external system.
- Provider keys or wallet private keys delivered into agent context, even encrypted.
- A paid customer inferred from discovery, synthetic tests, self-payments or successful deployment.
- Historical ACE, Solana/BAM, Child Safety, High-Velocity Facilitator, or standalone Web Extractor positioning as the current product.

## Identity ownership and rollout

`apps/relay/src/core/identity.js` owns the source name, overall product and descriptions.
`server.json`, `package.json` and `plugin.json` carry checked distribution metadata.
The canonical response layer owns public identity headers and API metadata.
Paid API Gateway remains a component name; it must not overwrite the overall identity.
Historical release audits describe their original builds and are not current specifications.

A merged and deployed build should report matching identity at `/identity`,
`/llms.txt`, `/server.json`, `/openapi.json`, MCP and A2A. Registries, npm packages,
container images and cached search listings change only through their own release
or indexing processes; editing source does not prove those external changes occurred.

See [strict governance](docs/strict-governance.md) for the security boundary,
forecast formula, APIs, operational limits and validation commands.
