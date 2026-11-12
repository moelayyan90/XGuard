# Agent Financial Authority — implementation and release evidence

Status: the base sandbox from PR #603 is deployed. This continuation adds usable no-funds execution, funded-license enrollment, owner key recovery controls and a complete **isolated** fee checkout/recovery path on `b22cfc6e93b7d7b7838d3e9ef6fcbf3a042747a7`. Live authority spending and live authority fee collection remain disabled in code. No financial wallet, real transfer, paid resource or contractual commitment was created.

The current release is gated on the ordinary CI, CodeQL and compatible gradual deployment. The deployment workflow saves a synthetic production lifecycle result and a verifiable sandbox receipt as an Actions artifact when the existing owner credential is available. This documentation does not substitute for that deployment evidence.

## Existing system and scope

The current tree has ProofRail ES256 evidence, legacy AgentAuthority mandates, Secretless Egress, a paid x402 gateway, SQLite Durable Objects, and a C2SP witness pinned to GBLIN. The native settlement implementation is isolated simulation. The public Worker bundle deliberately excludes native signing/ledger execution. `/supported` currently reports Base exact v2 with no local signers.

Repository inventory: 369 tracked files, 616 remote branch heads and 24 open PRs at inspection. These are inventory counts, not a claim that every historical branch was audited line by line. The active main tree and relevant infrastructure, governance, native-settlement, proof, execution and integration paths were reviewed. Stale incompatible PRs were not merged. This release reuses `AUTHORITY` and `PROOF_AUTHORITY` and adds no namespace, migration, dependency or production secret.

See [SDK and exact command contract](../sdk/financial-authority/README.md). New sources live in `apps/relay/src/financial-authority/`; legacy mandate routes are preserved. The English commercial page is `/authority`, the JSON contract is `/v1/authority/catalog`, and discovery is `/.well-known/xguard-financial-authority.json` after deployment. HTTP, OpenAPI, MCP and A2A share the same signature checks. Existing x402 payments are preserved; authority fee collection is deliberately not misrepresented as an active x402 service.

## Proven guarantees and limitations

| Property | Implemented boundary |
| --- | --- |
| Identity | Public P-256 key possession, separate owner/agent identities and per-organization ledgers; no KYC or real-world identity certification. |
| Delegation | Persisted owner/parent signatures, original envelope revalidation, exact payee/currency/asset/network scope, reduced time/depth/limits, maximum chain depth 8. |
| Budget | Principal plus declared provider-fee cap held across every ancestor and organization atomically. Optional service fees have separate global, currency-profile and ancestor budgets. Fixed UTC hourly/daily windows and lifetime caps; no conversion. |
| Replay and races | Signed audience/action/mode/org/nonces, digest-bound operation ID, transactional reservations and dispatch fencing. Duplicate execute cannot redispatch. |
| Revocation | Owner revocation serializes against reservation/dispatch. Already sent effects cannot be recalled. Pre-dispatch holds may be cancelled; unknown effects remain held. |
| Settlement | Built-in sandbox execution explicitly has no external effect. Private executors must attest the exact signed intent. Optional Base USDC verification also checks nonce, exact merchant Transfer, canonical block and 2 confirmations via read-only RPC; this is not irreversible finality. |
| Receipts | Existing ProofRail key signs typed ES256 JWS. A separate Node crypto implementation verifies offline with a separately pinned key. It does not contact XGuard. |
| Audit | Tenant-private events have monotonic sequence, SHA-256 predecessor linkage and a receipt-pinned head. This is not a public transparency log or a promise that a compromised issuer cannot equivocate. |
| Backpressure | At most 32 outstanding operations, 500 new operations/day, 5000 mutations/day, 100000 lifetime operations per tenant; bounded bodies, chain, provider response and audit page. These do not reserve account-wide Cloudflare quota. |
| Billing | One invoice only after completed signed delivery, explicit fee budgets and pinned recipient. Existing x402 PaidGateway handles nonce fencing, uncertain settlement and execution-credit recovery in closed tests. Simulation accounting is separate; actual revenue is zero and actual cost/profit unknown. Deployed fee collection is hard-disabled pending approval. |

An agent holding a separate spending credential can bypass a software gate. Production enforcement requires the actual executor/network isolation to use the gate. A noncompliant provider can violate exactly-once effects; XGuard promises no automatic redispatch and a stable provider idempotency key, not impossible distributed exactly-once execution.

No private signing key is included in discovery, audit responses, test artifacts or logs. Enrollment accepts the existing operator credential or a funded unrestricted customer license. A customer license admits one deterministic tenant after a pinned read-only balance check, never a credit consumption. Same-owner identical enrollment is idempotent; a license does not recover a lost owner key. A domain-separated, tenant-scoped HMAC admission token is issued at enrollment and checked before any object lookup; it does not replace the owner/agent signature. Rotating the operator credential invalidates these sandbox admission tokens. Generated fixtures contain only a sandbox **public** key and a signed sandbox receipt.

## Security and measured capacity

Run `npm run --prefix apps/relay authority:test`. The real workerd SQLite suite includes forgery, request tampering, scope expansion, shared-budget races, same-ID conflicts, nonce replay, wrong recipient/currency, revocation, forged executor evidence, response loss, SQLite restart, injected storage failure, and a failure after an external mock effect but before completion persistence. It also verifies with Node crypto independently of the server and checks bounded concurrent admission.

Evidence: [runtime-security.json](evidence/financial-authority/runtime-security.json), [sample receipt](evidence/financial-authority/sample-sandbox-receipt.json), [pinned sandbox public key](evidence/financial-authority/sample-sandbox-public-key.json). None is a real purchase or an independent security audit. The existing financial, C2SP, MCP, A2A and compatibility checks remain release requirements. Receipt examples are generated test evidence, with a separate sandbox public key. Browser/layout and current production evidence must be assessed from the release verification rather than inferred from these unit tests.

The 64-sample warmed one-leaf fixture measures the full local reservation/execution/signing path and exact SQL cursor counters. It does not measure internet latency, production CPU bills, real settlement, support cost or deeper-chain worst cases. Use the JSON evidence for the current quantiles and counters, rather than treating a documentation number as permanently authoritative.

## Infrastructure incident and deployment gate

Read-only provider logs from [audit run 42649723667](https://github.com/moelayyan90/XGuard/actions/runs/42649723667) show 3,534,573 SQL reads and 103,030 SQL writes at 2026-11-09 15:56 UTC. LiveShard contributed 98,817 writes, LiveControl 4,038, PaidGatewayState 172 and C2SPWitness 3. The account subscription API returned 403, so a full invoice/plan audit was not possible. Crawler request recording and indexed public aggregates dominate the observed writes; these counters alone cannot identify a per-client bot/human percentage.

The recovery changes from #599/#600/#602 are now deployed. [Current pre-release probes](evidence/financial-authority/production-before-commerce.json) identify `git-b22cfc6e93b7`, healthy storage, a working authority catalog and ready paid-service dependencies. This supersedes the historical exhausted-state snapshot above. The separate Infrastructure recovery audit workflow is stopped; this continuation puts its read-only provider audit into the enabled hourly Live monitor. Usage visibility failure fails that job, and the existing 50%/75%/90% thresholds remain. No provider limits or financial journals are weakened.

Do not bypass the capacity gate. After reset, rerun the unchanged CI and existing 0%/5%/100% compatible canary. The A2A production/candidate smoke also checks the new sandbox catalog, so an absent or incorrectly activated authority fails before promotion. Preserve the previous deployed version for rollback and all Durable Object bindings/state. Sandbox rollback must retain the isolated tables for a later compatible reader. Before live financial activation, extend the financial-state version guard and forward-recovery procedure for this new ledger; sandbox state must never be promoted into a live ledger.

## Competitive finding, pricing and demand

The specific opportunity is a cross-agent, cross-provider operational ledger combining signed attenuation, shared reservations, cancellation/dispatch semantics and recovery evidence. It is **not** the invention of delegation or authorization.

| Primary source | What the source establishes | Implication |
| --- | --- | --- |
| [AP2 specification](https://ap2-protocol.org/ap2/specification/) | Verifiable payment mandates; agent-to-agent mandate delegation is outside its current scope. | A concrete integration gap, not proof of monopoly or AP2 compatibility. |
| [MetaMask delegation reference](https://github.com/MetaMask/smart-accounts-kit/blob/main/skills/smart-accounts-kit/references/delegations.md) | Redelegation and cumulative spending/time/call restrictions already exist for MetaMask smart accounts. | Do not market signed chains alone as unique. |
| [Agent Mandates Internet-Draft](https://datatracker.ietf.org/doc/html/draft-hulea-wimse-agent-mandate-01) | Individual work in progress already specifies attenuation and subdelegation across domains; it is not an endorsed IETF standard. | Further evidence that delegation itself is not unique. No draft conformance claimed. |
| [Visa Trusted Agent Protocol](https://developer.visa.com/docs/trusted-agent-protocol/trusted-agent-protocol-specifications) | Agent recognition and signed commerce context. | Different trust boundary; no Visa approval is claimed. |
| [Coinbase AgentKit](https://github.com/coinbase/agentkit) | Wallet tools alone do not enforce spend caps, human approvals or destination allowlists. | Enforced financial policy can add value, only when execution actually passes through it. |
| [Cerbos pricing](https://www.cerbos.dev/pricing) | Open-source PDP is free; managed development starts at $25/month and production at $933/month, with principal-based pricing. | Generic policy checks have free substitutes; these prices are not a per-financial-operation benchmark. |
| [Oso pricing](https://www.osohq.com/pricing) | Developer tier is free; Growth is $15/user/month, for a different agent-security product. | No evidence that buyers accept $0.05 for XGuard. |

Proposed experiment: $0.05 only for an independently purchased, completed and verifiable financial authority operation after live readiness. Sandbox, rejection, receipt verification and status/recovery/retries cost $0. No mandatory subscription. This price is disproportionately high for tiny micropayments (5% of $1, 1% of $5), so the first buyer should run meaningful financial tasks with multiple workers/providers, not commodity free authorization calls.

At published Cloudflare paid marginal SQL rates, the conservative warmed one-leaf model is about $0.000026035 per completed operation for **SQL reads/writes only**. This is neither an actual unit invoice nor total variable cost. Gas/provider settlement, CPU/duration, retained bytes, payment fees, support, tax, key operations and adverse workloads remain unmeasured. For an 80% contribution target, total variable cost would have to remain below $0.01 at a $0.05 price. No volume discount is activated because willingness to pay and total cost are unproven.

No independent purchase or signed purchase commitment was found for this new product. [GBLIN #211](https://github.com/moelayyan90/XGuard/issues/211) establishes technical witnessing interest and a possible later non-load-bearing payment comparison; it is not an authority order, paid contract or proof of revenue. Do not republish private correspondence or count our own tests, grants, visits, credit awards or directory listings as sales.

A demand test must ask an actual multi-agent operator for a real budget-control task, a named economic loss it needs to prevent, and consent for a bounded paid pilot. Success means an independent customer pays once and then repeats for actual tasks. Stop or revise the offer if buyers can meet their need with the free alternatives. No outreach message, partner contract or spending was sent/accepted as part of this release.

## Growth, distribution and legal readiness

[63-stage model](evidence/financial-authority/growth-63-stages.csv) and [exact assumptions](evidence/financial-authority/growth-summary.json) are generated by `node scripts/authority-growth-model.mjs`. Stage 63 is 4,611,686,018,427,387,904 operations; cumulative stages are 9,223,372,036,854,775,807. These are mathematical targets, not a forecast. At a modeling horizon of one day/stage, stage 13 already exceeds the exclusive free SQL-write allowance in the conservative one-leaf model, even before existing public traffic. Current headroom must come from the live provider monitor; a successful reset is not proof of sustained capacity. The baseline model excludes invoicing. A separate observed two-level invoice journey used 107 authority-ledger reads and 57 writes across 10 calls; even that partial path exceeds an exclusive 100000-write/day allowance at stage 12. PaidGateway, ProofRail, duration, retention and gas add costs outside these counters. The test caps imply more than 9 quadrillion tenants to realize stage 63 in one day; this implementation cannot serve that target. There is no defensible exact global demand ceiling or measured market size here.

Organic expansion should occur only when a customer's real parent task delegates economically necessary actions to real workers. Do not charge for creating grants, inserting extra intermediaries, artificial agents, duplicated proof calls or circular payments. A platform integration may expand the number of genuine tasks and participating agent keys; it does not by itself validate paid demand.

Current KPIs: independent paid authority operations 0, collected authority cash 0, confirmed independent paying customers not established; commercial repeat rate/within-customer expansion are unmeasured. Sandbox completed-operation/outstanding counters and private audit pages are implemented. Production customer analytics and invoice-backed profit remain pending, rather than being inferred from sandbox counters.

| Distribution channel | Verified requirement and action |
| --- | --- |
| HTTP/OpenAPI | Explicit schemas, limits, examples, SDK and typed signed receipts implemented; public deployment still gated. |
| MCP | Three tools added to the existing server, tested with current/legacy official clients. The [official registry](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/remote-servers.mdx) requires a publicly accessible remote URL and namespace authentication. Existing publication workflow remains in place; do not advertise new live capabilities before deployment. |
| A2A | One signed-envelope skill added to the existing v1 card/SendMessage contract; [official discovery requirements](https://a2a-protocol.org/latest/specification/agent-card/) checked. |
| x402 | Existing settlement route retained. Authority fee collection is implemented and tested only in closed simulations. The deployed authority endpoint rejects payment before any challenge/settlement until separately approved. |
| AP2/Visa/provider partnership | No certification, registration, agreement or unsupported provider integration claimed. |

Legal activation requires a qualified jurisdiction-specific classification of the actual operating model. Jordan has [Virtual Assets Law 14/2025](https://www.jsc.gov.jo/Links2/ar/laws) and [provider licensing regulation 94/2025](https://www.jsc.gov.jo/News.aspx?group_key=key_news&id=12461). [FinCEN's 2019 guidance](https://www.fincen.gov/resources/statutes-regulations/guidance/application-fincens-regulations-certain-business-models) distinguishes software provision from a business accepting/transmitting value; operating software does not automatically avoid regulation. EU [MiCA, Article 59](https://eur-lex.europa.eu/eli/reg/2023/1114/oj/eng) imposes authorization requirements for covered crypto-asset services. These sources establish a review requirement, not a legal clearance for XGuard. No licensed custody or payment service was started.

Owner decisions are limited to concrete later gates: reviewed live financial model/executor and fee collection, any production financial key/gas/real payment, any paid infrastructure upgrade, and any binding legal/commercial commitment. Code work and safe testing do not require a new blanket permission.

## Continuation: executable checkout, recovery and onboarding

- `sandbox-simulation` gives admitted customers a complete no-funds lifecycle without a settlement adapter. The runnable SDK demo keeps its owner authentication key in a private local file, verifies the signed receipt and revokes its test grant.
- `service_fee_budget` at institution level and narrowed `service_fee_limit` on every policy/grant reserve a separate 50000-atomic USDC fee. A principal in another currency cannot escape that shared fee budget. Absence of opt-in creates no payable invoice.
- `checkout` issues a domain-separated private invoice capability. The fee recipient is the pinned XGuard treasury and never replaces the merchant recipient. An atomic invoice claim fences different wallet signatures **before** settlement. An uncertain attempt never allows a new debit. A definite failed-no-effect attempt permits at most 3 explicitly signed replacements.
- Fee collection reuses the existing x402 ledger, official client signature format, chain evidence and recovery credit. A lost response, storage failure after settlement, restart, two racing wallets, forged capability, shallow confirmation and noncanonical block all have executable tests in [commerce-security.json](evidence/financial-authority/commerce-security.json). Tests use in-process fixtures only; 0 real transfers and 0 commercial revenue.
- `disable-agent` fences new reservations/dispatch for a disabled key and its descendants. `rotate-owner` requires both old and new possession proofs, preserves historical grant verification and bounds key history. It does not reverse previously dispatched effects.
- Simulation assessed/collected amounts, pending invoices, actual service revenue and unknown actual costs/profit stay separate in owner metrics. Existing paid products keep their previous financial behavior.

The current 25 authority runtime scenarios, 19 commerce scenarios and funded-enrollment negative tests complement existing financial/MCP/A2A/C2SP tests; none is an independent audit. A full external security review remains a launch requirement for real financial execution. [SDK contract](../sdk/financial-authority/README.md) describes exact payloads and failure handling.

## Commercial experiment and expansion constraint

The first suitable prospect is a real operator whose existing parent task already spends through several workers/providers and needs one shared budget plus recovery evidence. Public multi-agent platforms are integration candidates, **not confirmed buyers**. GBLIN's technical witnessing interest is not a financial-authority order. There is still no independent purchase, paid pilot or signed buying commitment for this product.

At a $0.05 test price and an 80% contribution assumption, $400/day contribution would require 10000 genuine paid completed tasks/day. That is a calculation, not demand evidence, and exceeds the current exclusive free-write model before invoice/payment overhead and existing traffic. The 107-read/57-write fee-ledger sample corresponds to $0.000057107 at published paid marginal SQL rates, excluding allowances and the other costs. This is not the actual total price of serving a payment. No bulk discount is activated before actual variable cost and buyer willingness are measured. Actual unit cost cannot be claimed from modeled SQL rates or mock gas: provider invoices, real settlement costs and genuine buyer evidence are still missing.

A real pilot must record independent customer count, genuinely paid completed operations, repeat usage, expansion within that customer, collected cash, unsettled amounts, invoice-backed costs and net profit separately. Duplicated attempts, synthetic probes, self-payments and intermediary grants do not count. No outbound solicitation, third-party registration accepting terms, paid upgrade or financial activation was performed here.
