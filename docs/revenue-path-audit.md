# Revenue-path audit and shortest credible first fee

Baseline: main commit `693b7529549ae1444a93a311e696a3bbdbd1d394`, deployed
Worker version `0d6b17c8-01bb-4d2d-9cf2-9bc34a1df743`. Existing release evidence
is in `docs/execution-release-audit.md`. This audit does not claim a new paid
production transaction, a customer or measured profit.

## Existing surfaces and reuse decision

| Surface | Existing implementation / role | Revenue-path decision |
|---|---|---|
| `api.xguardgate.com`, `xguard-mainnet` | Canonical API Worker with PaidGatewayState, ProofAuthority and encrypted EgressKeyAuthority | Reuse all three authorities; add namespaced seller records, no replacement payment engine |
| `/v1/execute`, paid web fetch | Signed quote, x402 verification, durable settlement reservation, execution claim, stored result and signed receipt | Reuse the exact payment lifecycle for `/p/…` |
| `/verify`, `/settle` | Public facilitator compatibility/control paths with payment-context firewall | Keep unchanged; generic paid proxy uses the existing controlled facilitator client |
| Facilitators and Base RPC | Configured xpay primary and existing failover/read-only settlement reconciliation | Reuse; ambiguous settlement never resubmits |
| PaidGatewayState journal and commerce | First-party gross receipt accounting; traffic classes and result recovery | Preserve old ledger; add separate buyer gross, platform fee, seller liability and payout ledger |
| EgressMeter and scoped provider operations | Usage Credit billing before server-side credential injection | Keep as a supported secondary service; not seller revenue sharing |
| `hooks.xguardgate.com`, billing Worker | Lemon Squeezy checkout/webhooks and Usage Credit ledger | Subscription/credit infrastructure is not a marketplace payout system; do not repurpose it as one |
| Reconcile Worker | Existing payment maintenance | Keep; new seller payout objects have their own durable alarms and exact-transfer reconciliation |
| MCP, A2A, agent-card, payment manifest, x402 metadata | Working discovery and eight canonical agent tools | Add the sellable API catalog and buying instructions; no registry expansion project |
| `xguardgate.com` | Execution-focused landing and operator onboarding | Lead with monetizing an existing API; retain scoped execution pages |

No existing seller registration model, configurable marketplace split or
third-party seller payout authority was found in the baseline code. No funded
buyer signing key or treasury payout key was available in the execution
environment. The existing public receiving address is not signing authority.

The shortest credible fee is therefore: use the existing useful feed engine as
the first paid service, reuse the already deployed exact x402 path, bind the
platform allocation into its signed proof, then record a seller receivable
after delivery. A third-party service can activate only when its separate
payout signing authority is configured. Operator-funded acceptance tests must
stay SYNTHETIC/INTERNAL; a commercial external purchase is separate evidence.

## Utility and economics of advertised capabilities

Prices below are the baseline configuration, not market-tested willingness to
pay. Cost figures are configured budgets, not invoices. No per-capability
customer traffic or paid-conversion data was available to this audit; generic
discovery requests cannot establish demand.

| Capability / tool | Who needs it and why an LLM alone is insufficient | Payment rationale and marginal-cost evidence | Product decision |
|---|---|---|---|
| `xguard_execute`: web extraction | Workflows needing current structured HTML, metadata and provenance; a language model alone has no current HTTP content | Legacy price 0.003 USDC; bounded source requests, parser and storage, budget 0.0006 infrastructure + configured payment budget | Useful paid demo/support capability; not the primary positioning |
| `xguard_execute`: product offers | Price workflows with supplied product URLs needing normalized Product/Offer records | Legacy price 0.006 USDC; bounded fetch/parser cost; no exclusive data or verified stock advantage | Secondary; does not promise web-wide search or unique intelligence |
| `xguard_execute`: feed digest | Workflows merging RSS/Atom sources, deduplicating links and reporting source coverage | Legacy 0.002 USDC; gateway demo 0.10 USDC to exercise a 0.003 fee; budget 0.0006 infrastructure. These prices need demand validation | First useful gateway demo; no claim it is the best-priced source |
| `xguard_execute`: free extraction preview | API evaluators needing an immediate example before payment | Local parsing, no paid upstream access; zero price | Keep as a free evaluation route |
| Legacy `xguard.web.fetch` | Agents needing a bounded public fetch with payment and verifiable delivery | Legacy 0.001 USDC; budget 0.0001 infrastructure; generic HTTP fetch is widely available elsewhere | Compatibility/support, not a compelling exclusive product |
| `xguard_secretless_call` | API owners delegating an authenticated operation without sharing reusable secrets with an agent | Requires secure credential custody and authorization that an LLM itself cannot supply; existing Usage Credits, provider costs separate | Keep for protected operations and upstream access integration |
| `xguard_preflight` | Buyers checking scope, policy and allowed operations before a paid call | No provider execution; free support request | Helps purchases avoid avoidable failures |
| `xguard_quote` | Buyers deciding whether an exact request fits an authorized budget | Signed amount/input binding; free, no execution | Directly supports payment |
| `xguard_verify_receipt` | Buyers checking whether the delivered bytes and transaction match signed evidence | Signature verification, not source-truth verification; free | Directly supports trust in paid delivery |
| `xguard_discover` | Buyers seeking an available paid API or supported operation | Current catalog/availability requires service metadata, not model inference; free | Lead to a sellable endpoint |
| `xguard_status` | Buyers/operators checking whether to retry or stop before spending | Measured service state, not inferred uptime; free | Payment troubleshooting |
| `xguard_get_result` | Buyers recovering a response after network loss without paying again | Requires durable private operation state and original signed quote; free recovery | Essential payment support |
| Search, AI generation/routing, data query placeholders | No configured funded connector in baseline | No confirmed deliverable or marginal cost | Unavailable; do not feature as primary products |

## Measurement and operating limits

The new protected funnel exposes unique settled volume, delivered transactions,
earned platform fees, confirmed seller transfers and structured failure stages.
Historical first-party receipts stay in the legacy ledger; no migrations or
backfills relabel them as marketplace fees. Contribution uses explicit cost
budgets and is not net profit.

Failure after buyer settlement but before confirmed delivery creates an
unfulfilled liability. The conservative release refuses a second write and
requires review; it does not invent a refund or earned fee. Payouts are
asynchronous and their status is visible separately from the buyer result.
Exact repayment/reconciliation evidence is required before marking a transfer.

The production acceptance gate remains: PAID REQUEST, PAYMENT VERIFIED,
SETTLEMENT, UPSTREAM EXECUTION, RECEIPT, XGUARD FEE RECORDED. Tests with a fixture
facilitator, unsigned price probes, registry traffic and health checks do not
pass that gate. A revenue-capable gateway also needs a useful seller API and a
buyer willing and authorized to pay; deployment cannot guarantee adoption.
