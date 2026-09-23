> Historical build record. Current product identity and strict-mode behavior are defined in [CANONICAL_IDENTITY.md](../CANONICAL_IDENTITY.md) and [strict-governance.md](strict-governance.md).

# Agent Execution Gateway 5.2.0 — release audit

## Production acceptance update — 2026-09-20

The user authorized continuing the merge and deployment. PRs [#546](https://github.com/moelayyan90/XGuard/pull/546), [#547](https://github.com/moelayyan90/XGuard/pull/547) and [#548](https://github.com/moelayyan90/XGuard/pull/548) merged through the protected branch checks. [Deployment 35506333363](https://github.com/moelayyan90/XGuard/actions/runs/35506333363) succeeded for commit `815937199a14f37f7b579bc0b71f8aa1869c4fbb`, Worker tag `git-815937199a14`, at 10:54 UTC.

- Live identity reports **5.2.0 / Agent Execution Gateway**. MCP, A2A, egress, payment and reconciliation readiness all pass on that deployed tag. The configured Base RPC fallback was independently checked for chain ID `0x2105` and is shared by readiness and read-only reconciliation.
- The deployment passed identity, public contract, settlement context, outside-in, capability execution, replay, proof, commercial observer and buyer-discovery checks. No real payment was performed by those checks.
- A real browser completed the production controlled demo: authenticated request, no reusable secret returned, out-of-scope request blocked, same execution on replay, valid proof, and zero billed credits. This validates the controlled service; it does not establish permission for external vendor accounts.
- **229 Node tests passed** with zero failures: 212 relay/core/SDK/script checks and 17 billing/edge/reconciliation checks. The actual Worker runtime and SQLite Durable Object concurrency checks also passed.
- Payment-state version 1 is now tracked by the deployment guard. Forward migration is allowed; automatic rollback to an executable lacking the financial-state guards is blocked. Same-state rollback remains available.
- Official MCP Registry publication of 5.2.0 succeeded in [run 35506382223](https://github.com/moelayyan90/XGuard/actions/runs/35506382223). A simultaneous second publisher reported a duplicate version; the follow-up restores one automatic publisher. The canonical publisher's [successful rerun](https://github.com/moelayyan90/XGuard/actions/runs/35506382217) independently verified 5.2.0 and the matching live manifest. [Version normalization](https://github.com/moelayyan90/XGuard/actions/runs/35506627356) succeeded. Not Human Search recrawled at 11:00 UTC and now exposes the execution identity and 5.2.0 OpenAPI. MCPCentral's strict mirror check still fails; its freshness is separate from upstream publication.
- The facilitator safety and public-contract checks passed. Its final discovery check still expected three tools and the old extraction homepage; the follow-up checks the exact eight-tool manifest from the deployed commit and the current execution homepage. Payment and security assertions remain in place.
- Production security, execution monitoring, public metadata, distribution contracts, WordPress integration, public-index refresh, IndexNow, A2A submission and Better Than HTML submission workflows passed. A successful submission workflow does not prove that a third-party listing has refreshed every field or passed protocol conformance.
- Billing service health and trusted key authentication work on the existing **0.3.0** billing deployment. The separate billing release remains gated because `BILLING_RELEASE_APPROVED` is not configured. Protected operator KPIs report `operator_metrics_not_configured` until `XGUARD_OPERATOR_METRICS_KEY` is configured; the observer also has no `XGUARD_OPERATOR_KEY` for private balances.
- No real paid settlement, external-provider acceptance, merchant outreach, customer adoption or revenue is claimed. Those require actual authorized accounts, scope and payment evidence.

The remaining sections preserve the **2026-09-19 pre-deployment audit** and its then-current constraints. Statements below that call the implementation a candidate, describe 5.1.0 as production, or require deployment authorization are historical and superseded by this update. The earlier agent-token-usage task remains in the same merged review chain.

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
