# XGuard commercial execution — 2026-11-17

## Observed baseline and recovery

Baseline source: 0f72c33c6bea0e138e24f48d5dc6397fe66e7fe4. Active Worker: 80a0005e-457b-4bb2-9087-46d507b0f6c4. Repository recovery branch: restore/pre-commercial-20261117-0f72c33. Public probes and actual PayPal activation blockers are retained in docs/evidence/commerce/production-before-20261117.json. Existing bindings, DO migrations, domains, treasury destination, GBLIN witness key and public fact/history/evidence/change routes are preserved.

## Concrete implemented scope

13 deterministic bounded paid adapters share the existing order, validation, x402 settlement, PayPal capture, private result recovery, metering, per-service financial ledger and signed receipt pipeline. Each input has an exact bounded schema. No adapter contacts an external supplier or spends capital. USD checkout uses the existing $2/task minimum; the new agent adapters use 0.100000 USDC/request, subject to actual readiness. These prices are proposed XGuard offers, not demonstrated willingness to pay or measured net profit.

New adapter IDs: commerce-burn-breaker, commerce-context-capsule, commerce-dom-to-api, commerce-prompt-firewall, commerce-redact, commerce-lead-qualify, commerce-governance-check, commerce-iam-check, commerce-audit-manifest, commerce-reconcile-invoices, commerce-compare-offers, commerce-market-spread, commerce-latency-plan.

Inputs are limited to 14000 JSON bytes so the existing 16384-byte agent contract can carry them. Unknown fields, negative monetary values, amount overflow, duplicate references, invalid times, unauthorized data-rights assertions, malformed selectors and oversized DOM output are rejected before payment. All money calculations use integer cents/micros and BigInt intermediate arithmetic.

Security scans and PII redaction use stated pattern coverage, not an enterprise semantic-security guarantee. A spend or IAM decision must be enforced by the caller; it does not provision credentials, stop an external process or run an arbitrary-code sandbox. Context packaging deduplicates exact paragraphs; it does not promise semantic compression. Supplied RFQs and quotes are not independently verified demand or accepted supplier agreements. The existing receipt signs the delivered report, not the truth of its source claims.

## Full requested product scope

Every requested service remains tracked. An adapter is a partial implementation of the wider product. The table deliberately states the missing engineering and commercial dependencies. No unavailable market is offered for sale.

| Section | Product | Implemented paid adapters | Delivered scope | Remaining dependencies |
| --- | --- | --- | --- | --- |
| 3.1 | Productized technical services | csv-clean, live-extract | Bounded CSV processing and existing public-read execution. | Verified card merchant activation for human checkout; Independent paid demand |
| 3.2 | Micro-SaaS | csv-clean, live-batch | Per-operation checkout, private recovery, signed results. | Subscription and prepaid-account product activation; Verified card merchant activation |
| 3.3 | Permissioned B2B lead qualification | commerce-lead-qualify | Rules-based qualification of customer-provided licensed company RFQs. | Licensed intent data supply; Consenting buyers and contracted lead purchasers; Independent demand verification and CPA attribution |
| 3.4 | Source and enterprise licensing | — | Source remains Apache-2.0. The operator can discuss implementation/support or separately owned additions. No exclusive rights are transferred. | Owner-approved commercial terms and rights audit; Enterprise package and buyer agreement; Final owner approval for ownership transfer |
| 3.5 | Semantic Loop & Burn Breaker | commerce-burn-breaker | Spend-cap and exact-fingerprint STOP/CONTINUE evaluator. | Runtime enforcement integration; Semantic loop detector; Verified savings attribution and revenue-share contract |
| 3.6 | Agent Reputation & Proxy Vault | — | Existing authority sandbox is preserved; no identity rental or external credentials are sold. | Identity owners and verified delegation; Credential custody security integration; Contracted permissioned network and independently validated reputation |
| 3.7 | Agentic Escrow & Dispute Arbiter | — | No custody or binding arbitration is offered. | Eligible licensed custody/escrow provider; Merchant approval and dispute rules; Tested conditional payout adapter |
| 3.8 | Pre-Compiled Context Capsules | commerce-context-capsule | Versioned attributed text packaging and exact paragraph deduplication. | Licensed commercial content suppliers and purchasers; Semantic compilation and retrieval index |
| 3.9 | Live DOM-to-API Compiler | commerce-dom-to-api, live-extract | Supplied HTML to CSS-mapped structured JSON; existing authorized public extraction. | Customer-owned live source integrations; Hosted generated endpoints and scheduled schema change validation |
| 3.10 | KV-Cache Sharing Marketplace | — | No cache inventory or cross-tenant memory access is sold. | Compatible inference providers with cache export/import contracts; Measured inventory, tenant isolation and secure transport; Real supply and prepaid buyer demand |
| 3.11 | Semantic Prompt Firewall | commerce-prompt-firewall | Explicit-pattern triage with quarantine findings and stated false-negative risk. | Runtime tool-output policy integration; Adversarially evaluated semantic detector; Customer-approved enforcement deployment |
| 3.12 | Speculative Execution & Latency Arbitrage | commerce-latency-plan | Select a cost-bounded candidate from customer-supplied latency observations. | Eligible funded provider adapters; Speculative job scheduler, cancellation and measured speedup; Resale rights and real resource supply |
| 3.13 | Enterprise Governance & Compliance | commerce-governance-check | Exact actor, tool, resource, approval, time and spend-policy evaluation. | Enterprise enforcement integration and contract; Jurisdiction-specific compliance rules and audit approval |
| 3.14 | Compliance & Audit Vault | commerce-audit-manifest | Hash-chained evidence export and existing signed delivery receipts. | Customer-approved retention and immutable archive infrastructure; Incident reconstruction and enterprise archival contracts |
| 3.15 | Zero-Trust PII & Secret Redaction Proxy | commerce-redact | Pattern-based redaction of supplied text with no retained reversal map. | Inline proxy integration and customer data-processing terms; Broader evaluated PII coverage and secure tokenization |
| 3.16 | B2B Agentic Clearinghouse | commerce-reconcile-invoices | Integer-cent reconciliation of provided invoices, captures and refunds. | Authorized provider settlement feeds; Eligible clearing/payment partner; Approved dispute and payout workflows |
| 3.17 | Dynamic Agent IAM & Sandboxing | commerce-iam-check | Least-privilege policy decision report. No new credentials or arbitrary-code execution. | Customer IAM provisioning and authenticated identity integration; Isolated execution provider and temporary credential vault |
| 3.18 | Decentralized GPU / Compute Arbitrage | — | Existing compute discovery and truthful readiness are retained at /compute. | Eligible funded compute provider; Resale agreement and capacity inventory; Verified buyer demand before any resource purchase |
| 3.19 | Real-Time Human-in-the-Loop & Private Data | — | No human workers or exclusive datasets are claimed. | Consenting paid human task suppliers; Data rights and quality agreements; Funded task demand and payout channel |
| 3.20 | AI Traffic & Intent Arbitrage | commerce-lead-qualify | Qualification of supplied company RFQs only; no access to private AI traffic. | Permissioned commercial intent distribution; Supplier CPA agreements and verified conversion callbacks |
| 3.21 | Autonomous B2B Deal-Closing Agents | commerce-compare-offers | RFQ comparison and non-binding supplier selection from supplied offers. | Verified RFQ and supplier network; Authorized negotiation/order adapters and contract workflow; Contracted commissions and signed settlement evidence |
| 3.22 | Fragmented Market Arbitrage Mesh | commerce-market-spread | Integer-cent resale margin evaluation with rights and cost gates. | Authorized executable market feeds; Real orders and funded supplier commitments; Verified commission and settlement adapters |
| 3.23 | High-Ticket MCP Lead Routing | — | Free search/compare over approved configured partners; no partners are assumed. | Approved supplier referral contracts; Verified listings and buyer distribution; Conversion callbacks and commission collection |
| 5 | XGuard Live Facts & Commercial Intelligence | live-batch, live-history, live-compare | Paid stored fact bundles, bounded observation history and comparisons. Public fact discovery remains available. | Licensed vertical commercial datasets; Contracted dedicated enterprise feeds and buyers; Independent paid demand |

## Unified payment and provider status

- PayPal receiving identity is pinned to moelayyan2026@gmail.com. Client ID, client secret, merchant ID, webhook ID, verified receiver and activation are missing from the current Worker. No live credential is created, copied or disclosed by this release.
- Existing x402 Base USDC settlement remains the agent payment route. Its actual readiness must be checked at /api/paid/v1/readiness. No new direct transaction-hash payment system is offered.
- The existing treasury address is preserved. It is not asserted to be an OKX deposit address. Automatic sweeping to OKX is unavailable.
- Additional methods have explicit inactive status at /v1/commerce/providers. Visa/Mastercard card funding depends on PayPal eligibility; Advanced Card Fields, Apple Pay, Google Pay, bank/local methods and Payoneer payouts are not claimed active.
- Pending captures cannot fulfill orders. Denials and approval reversals stop delivery. Refund callbacks can resolve a capture through an official parent link without fetching event-supplied URLs. Partial refunds hold the result for reconciliation. Delayed completion callbacks cannot release a refund, dispute, reversal or denial hold.
- Actual refunds and payout transfers require separately authorized financial execution. Paid delivery failure remains a recorded refund obligation. No irreversible fund movement was performed during development.

## Safe staged activation

1. Deploy reader 6 / writer 4. New commerce purchases are blocked by a committed writer gate; existing services continue. PayPal sandbox exercises are isolated and may use the new adapters with test money only.
2. Verify this exact reader on production, including health, MCP/A2A, public facts, C2SP witness identity, payment readiness, commercial catalog and the expected no-charge writer gate.
3. Capture the reader-6 production version and source as the post-activation rollback target.
4. In a separate release, set payment_state_write_version to 6. The normal deploy guard must confirm compatibility with the actual reader-6 production baseline. Never roll paid commerce obligations back to pre-commerce reader 5.
5. New adapter endpoints can issue x402 payment challenges only after activation. A challenge is not a real payment. Production payment proof still requires an independently funded legitimate buyer and settlement confirmation.

PayPal human activation additionally requires account-side credential/webhook authorization, verified ownership, qualification and an owner-approved funded purchase/refund canary. Existing app permissions are not silently broadened. A PayPal email alone is insufficient.

## Commercial discovery and integration

/products and /products/{id} expose actual adapter scope plus outstanding dependencies. /v1/commerce/catalog retains all 23 requested products plus Direct Facts. /v1/commerce/purchase returns a shared checkout URL without charging. /v1/commerce/offers/search and /v1/commerce/offers/compare provide free discovery over operator-approved contracted partners only. With no configured partner agreements the result is empty. Commission rates are disclosed and never used as a hidden ranking key. No earned commission is generated from a quote or a list entry.

MCP/A2A expose catalog, supplied-task quotation, existing-result verification and purchase links. Unavailable negotiation/deal tools return activation requirements and no external action. Existing paid fact bundles, historical exports and comparisons are retained. No free discovery or legacy integration is silently removed.

Approved inventory is configured only via XGUARD_APPROVED_PARTNERS_JSON. Records require a bounded ID, HTTPS offer URL without embedded query credentials, capabilities, agreement reference, expiry and a disclosed commission rate. Configuration is not independent contract verification. Live price/capacity feeds, conversion callbacks and commission collection are not activated by filling this registry.

## Demand evidence and limitations

Primary references checked on 2026-11-17:

- https://dromo.io/pricing — commercial data import/cleanup category and public pricing. This is evidence of a priced category, not evidence that Dromo buyers want XGuard.
- https://pangea.cloud/docs/api/redact — a real redaction API category with defined service rules. XGuard is not represented as equivalent in detection coverage, certifications or deployment.
- https://blog.apify.com/standardizing-actor-pricing/ — marketplace transition toward usage-event pricing. No XGuard Apify actor, account or paid marketplace listing is claimed.
- https://developer.paypal.com/payment-methods/webhooks/ — capture completion, pending and denial handling.
- https://developer.paypal.com/platforms/checkout/advanced/integrate — official SDK and merchant eligibility prerequisites.
- https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-your-git-database — repository object and branch publication flow.

The existing first-party MCP, A2A, OpenAPI, x402 catalog and product pages are distribution surfaces. No exclusive supply, CPA contract, referral payout, grant award or new customer is inferred from their existence. The current official MCP listing, when verified, is recorded separately in docs/evidence/commerce/mcp-registry-20261117.json. Broader distribution and scarcity are unresolved commercial dependencies.

Visual references reviewed in Pinterest search for minimal SaaS dashboards, including /pin/333829391151922542/ and /pin/1140114461955307409/: neutral space, restrained green and clear reading order. No reference artwork is copied into XGuard.

## Revenue and accounting

New services participate in the existing deduplicated live-commerce service ledger, including confirmed cash, recognized delivered revenue and undelivered liabilities. Attempts, synthetic payments, internal tests, quote totals and supplied invoice amounts are not revenue. Existing owner-only /admin/paid-revenue remains the aggregate source; access and authentication are preserved. Infrastructure invoices, supplier costs, taxes and net realized profit remain unknown until supported by actual data.

No real payment, refund, upstream purchase or supplier payout was executed in this development run. No independent sale was established. This does not imply the entire account balance or historical revenue is zero. The 100/300/400/1000 USD daily figures remain goals with no revenue guarantee.

## Validation

Unit contracts cover all 13 adapters, amount/rights/input boundaries, source attribution, exact policy decisions, redaction coverage, hash-chain integrity, RFQ economics, supplier registry integrity and absent-provider purchase rejection. Real workerd SQLite tests exercise synthetic PayPal capture through delivery for all 13, signed receipts, concurrency, recovery, failed capture/storage, partial/full refunds and delayed callback holds. An isolated x402 test settles mock authorizations, delivers a new product, replays without another charge and verifies per-service ledger attribution.

All existing CI checks remain required, including typecheck, full unit suite, runtime, financial recovery, C2SP, MCP/A2A, baseline compatibility/capacity and production dry-run. Deployment acceptance is recorded separately from these simulated payment tests.

## Canary recovery record

The first supporting upload was not promoted: an older paid-smoke assertion mistook the new adapters for network routes. A transient prior-version public response also failed candidate identity verification. The existing rollback returned 100% traffic to the previous version. The follow-up keeps strict candidate identity, legacy price and no-payment checks, adds an exact commerce contract assertion and scopes public canary URLs to the candidate. See docs/evidence/commerce/canary-recovery-20261117.json. This is an operational recovery, not a payment failure or a successful new sale.
