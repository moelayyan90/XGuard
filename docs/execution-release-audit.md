# Agent Execution Gateway 5.2.0 — release candidate audit

Observed 2026-09-19. This is a candidate implementation, **not a production acceptance claim**. The earlier agent-token-usage task is retained in the same review chain.

## Deployed baseline and access boundary

`https://xguardgate.com/identity` returned version **5.1.0**, old product identity, and Worker tag **git-2a546589e186** on 2026-09-19 at 09:30 UTC. Main remained `2a546589e1863a86efd2635d971640ddacedf466`. The candidate must not be described as deployed while that observation remains current.

Automatic approval review rejected the earlier default-branch push because it could trigger a production deployment without sufficiently explicit authorization. No merge, default-branch update or deployment was used to bypass that decision. The verified public repository can receive the implementation on a review branch. Live Cloudflare account configuration and provider credentials were not available through a callable authenticated connector.

## Requested phases and evidence

| Phase | Candidate result | Remaining production evidence |
| --- | --- | --- |
| 0 Audit | Entry chain, manifests, Workers config, DO classes, existing financial tests and live identity inspected | Authenticated deployed bindings, domains and secret presence |
| 1 Execution-first MCP | Eight primary tools; deterministic local initialize/list; legacy tools retained | Repeated production probes on the deployed candidate |
| 2 Providers | 16 explicit bounded operation adapters; strict resource and method policies | Real permitted account acceptance for each vendor; no vendor credentials supplied |
| 3 Website | Execution-first home, connect, developers, operator onboarding and demo | Deploy and verify browser navigation against that release |
| 4 MCP reliability | Discovery does not await RPC, billing, storage or facilitator calls; free-call synthetic monitor | Actual rolling production observations; no uptime percentage asserted |
| 5 Identity | Shared 5.2.0 identity; MCP/A2A/OpenAPI/plugin/client docs updated | Active deployment plus subsequent registry refresh |
| 6 Payment state | Durable reservation before settlement; canonical lifecycle; once-only execution claim | Real authorized paid production acceptance |
| 7 Facilitators | Per-rail bounded telemetry, circuit break, explicit same-network fallback selection before reservation | Actual facilitator observations and configured fallback approval |
| 8 Events | Scrubbed durable request journals and separated traffic classes | Configure protected analytics key; observe external traffic |
| 9 Readiness | Component endpoints, billing/signing/state probes and read-only chain-ID check | Cloudflare binding/secret/domain verification and live RPC results |
| 10 Free Secretless demo | Real encrypted credential and ES256 proof against an authenticated internal DO service | Production demo after deployment; not an external-vendor acceptance test |
| 11 Self service | Operator credential/capability form; execute/replay/revoke; JS/Python/curl examples | Browser acceptance with operator-supplied real provider scope |
| 12 Trust/status | Measured status, threat model, payment lifecycle, proof and incident pages; existing legal pages retained | No historical uptime or certifications claimed |
| 13 Repository | Labels applied to incident/distribution/legacy/design-partner work; superseded PRs #501/#503 closed with evidence | Milestone creation is prepared in the monitor workflow; GitHub connector lacks that operation and browser is signed out |
| 14 Distribution | Current public entries inspected; stale metadata recorded below; publisher gates updated | Candidate deployment precedes publishing its identity; blocked directories remain unverified |
| 15 Adoption | Three source-specific [integration packets](design-partner-packets.md), with canary, rollback and zero price/payTo changes | No outreach, third-party changes, merchant consent or customer adoption claimed |
| 16 KPIs | Authenticated commercial ledger plus actual execution samples and active operator/capability inventory | Protected secret configuration; historical coverage explicitly incomplete |
| 17 Tests | Security, concurrency, billing order, replay, signatures, demo and compatibility checks implemented | Validation results below; vendor/live payment tests remain separate |
| 18 Acceptance | Reviewable candidate and deployment/monitoring gates | Blocked pending explicit default-branch/deployment authorization and live verification |

## Validation

- Wrangler 4.130.0 builds the canonical Worker successfully in dry-run mode.
- Actual workerd with SQLite Durable Objects passes three MCP initialize/list/free-call rounds, authenticated demo, scope denial, durable replay and proof verification.
- Sixteen concurrent demo requests produce one completed execution, no external egress and zero billing. Demo capabilities/operators do not enter the paid operator inventory.
- 225 Node tests passed with zero failures: 208 relay/core/SDK/script checks and 17 billing/edge/reconciliation checks. A focused paid-receipt test also verified the new receipt endpoint and rejected tampering. JavaScript syntax, 31 workflow YAML files, public-metadata contracts, settlement-safety behavior and npm package dry-run checks passed.
- Provider tests use controlled fixtures. They prove scope and billing boundaries, not live provider account permission or availability.
- Visual browser testing of the candidate is not established: the standalone test browser was unavailable, and the supported cloud browser does not have the local fixture exposed. Hosted-page JavaScript was exercised against the actual handlers: create, execute, replay and revoke succeeded with one debit and one provider fixture call. This does not claim a real browser visual acceptance.

## Public distribution snapshot

Read-only observation on 2026-09-19; a listing is not adoption or revenue.

| Surface | Observed state | Action |
| --- | --- | --- |
| Official MCP Registry | Request timed out in this session; exact current entry not verified | Existing publisher must publish and verify exact candidate version after deploy |
| MCPCentral | HTTP 200; version **5.0.2**, old Secretless Agent Gateway title, correct MCP URL | Keep strict version check; daily mirror remains stale, not a production execution incident |
| A2A Registry | Version **5.1.0**, old identity; health true but task conformance false and a recorded `message/send` error | Candidate advertises A2A 1.0 `SendMessage`; verify task conformance after refresh |
| Not Human Search | Old public-extraction title and 5.1.0 OpenAPI snapshot, crawled September 17 | Refresh existing entry only after new identity is deployed |
| Glama | HTTP 200, old Secretless Agent Gateway title, canonical MCP endpoint present | Existing ownership signal retained; no indexing/usage claim for 5.2 |
| MCPBeat | HTTP 403 from this session | Unverified; no invented score or uptime |
| PulseMCP | HTTP 403 from this session | Unverified; no claimed listing update |
| x402 compatibility discovery | Existing signed-price, network, recipient and settlement contract retained in tests | Validate public manifest and authorized paid flow after deploy |

Sources: [MCPCentral record](https://mcpcentral.io/api/servers/io.github.moelayyan90%2Fxguard-control-plane), [MCPCentral read-only API](https://mcpcentral.io/docs/consume-the-registry), [A2A search](https://a2aregistry.org/api/agents?search=XGuard), [Not Human Search record](https://nothumansearch.ai/api/v1/site/xguardgate.com), [Glama](https://glama.ai/mcp/servers/moelayyan90/XGuard).

## Deployment gates and rollback

1. Review and authorize merging the candidate into main, acknowledging that the existing workflow deploys it. Existing treasury addresses, prices and the firewall are unchanged.
2. Deploy using existing bindings and migrations. No DO class is removed or renamed. Configure only missing secrets through the established secret-management path; do not put values in git, logs or chat.
3. Run identity, agent-usage, outside-in and execution production verifiers against the exact Worker version tag. Confirm billing, proof, payment and reconciliation readiness independently.
4. Run any real paid or provider acceptance only with an explicitly authorized scope and spending limit. Record actual settlement and receipt evidence; a self-funded canary is not revenue.
5. Refresh existing registry entries from the deployed endpoints. Preserve strict exact-version checks and report stale mirrors without fabricating success.
6. For rollback, inspect outstanding `lifecycle_version:1` operations first. Do not blindly roll back to an older executable that can resubmit an ambiguous settlement or reclaim a held execution. Keep the read-only reconciliation and no-repeat guards, disable new candidate traffic if necessary, and retain the ledger until unresolved operations are accounted for.

## Review-branch CI follow-up

At commit `68e318f`, Relay, Agent Plugin, Billing, Edge Gate, Universal Gate, SDK, public metadata, distribution contracts, index verification and facilitator CI passed. The WordPress PHP checks passed, but its subsequent probe compared the undeployed candidate version with old production. The follow-up keeps candidate metadata validation on pull requests and runs the strict production-version check only after a successful deployment or explicit manual verification. No production check was weakened to accept a stale release.
