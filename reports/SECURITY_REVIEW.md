# XGuard security review

**Review date:** 2026-08-14  
**Release:** `0.1.0-alpha.0`, testnet-only

Architecture, protocol compatibility, financial accounting, payout controls, HTTP/edge security, tests, live state, and documentation were reviewed and reconciled in the implementation.

## Release-blocking findings closed

| Finding                                                                     | Resolution                                                                                                                        |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Permit2 nonce could be replay-keyed by token/spender                        | Key is chain + owner + nonce, matching the owner nonce-bitmap domain; exact proxy and uint256 bounds are enforced.                |
| Empty admin token could authenticate a missing header                       | Production token is required and at least 32 characters; comparison is constant-time.                                             |
| Request/downstream bodies were capped after buffering                       | Node and Worker stream with hard byte caps, early length checks, cancellation, UTF-8 checks, and bounded JSON structure.          |
| Node downstream could redirect, resolve privately, or return unbounded data | HTTPS only, public DNS only, DNS-pinned dispatcher, redirects rejected, and content/size/schema bounded.                          |
| Worker capability fetch followed redirects implicitly                       | Every facilitator fetch uses `redirect: "manual"`; a permanent Workers-runtime test proves a redirect degrades the route.         |
| Durable Object RPC could reject non-cloneable settlement objects            | Settlement results become strict JSON data before `finalize`; a Workers-runtime regression covers finalization and cached replay. |
| Anonymous Worker traffic lacked resource controls                           | Per-client/global rate limits plus per-client Durable Object concurrency leases are active.                                       |
| Mainnet was enabled by self-attested environment strings                    | Both shipped gateways reject mainnet in code. Reusable core requires a registered independent finality adapter.                   |
| A facilitator `success` response could immediately bill                     | Mainnet success must be independently proven and identity-bound; malformed/false/uncertain responses cannot bill.                 |
| Post-submit failure could release funds without proof                       | Mainnet rejection stays ambiguous until independent unused-authorization evidence exists.                                         |
| Stale prepared/started Worker ownership could hang or retry unsafely        | Pre-submit work expires failed/no bill; post-submit work becomes ambiguous/no retry; alarms and outbox self-heal.                 |
| Payout safety could be bypassed and provider fees reused                    | Safety is re-evaluated atomically; gross destination + fee is reserved; reconciliation/ambiguity blocks preparation.              |
| Payout terminal states trusted untyped reason strings                       | Terminal transitions require matching typed provider evidence and preserve fee/return accounting through compensating entries.    |
| Capability and checker output overstated compatibility                      | Advertising is mechanism/extension aware and limited to the implemented v2 exact-EVM Base Sepolia matrix.                         |
| CLI migration could forward old provider credentials                        | Credential/header configurations are refused; URLs are validated; old URLs are never printed; rollback is hash-safe.              |
| Local test-wallet environment files risked accidental packaging             | `.xguard*.env` is ignored by Git and Docker; tracked-secret checks are fail-closed and package allowlists exclude them.           |

## Remaining release boundaries

No known Critical or High defect remains for the deployed testnet scope after the suite and evidence-based live reconciliation. This is not a mainnet security approval. Mainnet remains blocked because the repository has no production chain-finality adapter, authorized mainnet provider, production multi-instance financial source of truth, deployed external alert/backup channel, or independent security review of the final production implementation and configuration.

The live Worker uses JavaScript safe integers only for code-gated, zero-fee testnet projection. Billable money uses exact `bigint` micro-USD in the Node ledger; this alpha does not authorize Worker mainnet accounting.

## Fail-closed invariants

- settlement crosses the outbound boundary at most once under XGuard control;
- ambiguity never triggers an automated settlement retry or bill;
- duplicate logical payment creates at most one immutable usage event;
- testnet never earns an XGuard fee;
- customer liabilities never enter distributable owner profit;
- payout never proceeds with unresolved reconciliation, uncertain balance/finality, unverified destination, incomplete KYC, provider incident, or prior ambiguity;
- neither owner bank information nor any production credential exists in source, logs, docs, frontend, API responses, or test fixtures.
