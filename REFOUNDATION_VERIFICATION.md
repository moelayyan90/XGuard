# Refoundation verification — 2026-09-09

This release implements and tests outcomes. It does not prove product-market fit,
new customers or revenue. Production results are recorded separately from fixtures.

## 1. ROOT CAUSES FOUND
Single paid HTTP fetch offers little advantage over direct access; failed quote shapes,
operator setup, conflicting discovery lists, and a demo ending at 402 create friction.
The recorded baseline has zero successful paid deliveries and revenue; see the audit.

## 2. USELESS COMPLEXITY REMOVED
The default MCP catalog now has three tools. Fake/unfunded capabilities and explanatory
A2A skills are removed from primary discovery. Existing explicit legacy calls remain
compatible. The homepage and first example no longer require a quote/preflight tutorial.

## 3. HIGH-VALUE CAPABILITIES SELECTED
Multi-page evidence, structured product offers, and merged RSS/Atom digests.
Selection scores are commercial hypotheses, not measured willingness to pay.

## 4. ACTUAL CAPABILITIES IMPLEMENTED
Three bounded live-source pipelines plus free extraction of supplied/sample HTML.
No credential setup, account or provider ID is required. Public pages can still block
access; JavaScript rendering, search, OCR and general LLM inference are not included.

## 5. NEW DISCOVERY FLOW
Root/agent instructions → a direct first-result example, or executable capability index
→ one canonical execute endpoint. Each capability has a public page, schema, price,
limitations and REST/MCP/A2A mappings. Unsupported requests include alternatives/repair.

## 6. NEW ONE-CALL EXECUTION FLOW
POST /v1/execute accepts supported English/Arabic intents, structured JSON, URL/action,
resolved read-only OpenAPI operations, MCP arguments, A2A parts, HTTP envelopes and
safe GET curl descriptions. It does not execute shell commands or arbitrary operations.

## 7. PAYMENT FLOW
Free preview: one HTTP request. Paid: initial 402 then one programmatic paid retry,
with the exact original intent and signed quote. The existing rail abstraction verifies,
settles, binds authorization, stores delivery and signs receipt/proof. A local helper
checks budget/network/asset/recipient shape before signing and reuses payment on a
transport retry. Credit redemption and read-only recovery retain the original result.
Only x402-v2 USDC is live for these anonymous paid outcomes; no fictitious rail is listed.

## 8. FALLBACK/ROUTING SYSTEM
Up to three source groups, one optional backup each. Capability-specific parse quality,
observed success/latency and circuit state select candidates. Public-source provider fees
are zero; a fixed price includes bounded fallback. No global provider quality ranking is
claimed. Product groups require matching identifiers and currency; coverage is explicit.

## 9. PUBLIC URLs
- https://xguardgate.com/
- https://xguardgate.com/try
- https://api.xguardgate.com/agent.txt
- https://api.xguardgate.com/v1/capabilities
- https://xguardgate.com/capabilities/web-extraction
- https://xguardgate.com/capabilities/product-offers
- https://xguardgate.com/capabilities/feed-digest
- https://xguardgate.com/capabilities/extract-preview
- https://api.xguardgate.com/openapi.json
- https://api.xguardgate.com/mcp
- https://api.xguardgate.com/.well-known/agent-card.json

## 10. MCP TOOLS
xguard_discover; xguard_execute; xguard_get_result. Paid invocation is explicitly
annotated as potentially charging. Read-only result recovery never executes again.

## 11. A2A SKILLS
extract-preview, web-extraction, product-offers, feed-digest, each backed by execution.

## 12. OPENAPI CHANGES
POST /v1/execute leads the document. Capability inspection and result recovery have
paths. Repair, payment and receipt behavior are documented; legacy operation paths remain.

## 13. SEO/DISTRIBUTION CHANGES
Server-rendered capability pages, canonical URLs, metadata, Service structured data,
sitemap, agent.txt, llms.txt and registries describe the same executable catalog.
MCP registry metadata moves to 5.1.1 without changing the legacy runtime identity 5.1.0.
IndexNow submission includes the four real outcome pages. Registry submission and
search-engine indexing must be observed independently of deployment success.

## 14. E2E TEST RESULTS
The local CI behavior suite passes 90 tests, including nine HTTP-socket tests covering
all seven requested flows and additional credit recovery and input/payment attacks.
Quote, receipt and proof signatures are real cryptographic operations. Facilitator,
DNS and source fixtures in that suite are controlled simulations. No blockchain payment
occurred in those tests; synthetic traffic is excluded from revenue/adoption counters.
Wrangler 4.123.0 dry-run succeeds (about 1,225 KiB uncompressed / 380 KiB gzip).
Local workerd startup was blocked by uv_interface_addresses in the workspace; CI now
also starts the actual Worker and executes the free preview before release.

Real public source probes outside the fixture suite successfully parsed Adafruit product
50, Hacker News RSS and GitHub Changelog RSS on the audit date. Those checks establish
source/parser compatibility at that time, not a paid production outcome or availability SLA.

## 15. PRODUCTION VERIFICATION
Pending the review/CI/deploy sequence at this document's initial commit. The production
verifier checks root-to-free execution, all four capability schemas, paid intent pricing,
legacy payment safety, MCP/A2A parity, canonical pages and editor configuration. It does
not spend money. Final observed deployment and distribution results belong here.

## 16. REMAINING BLOCKERS
No funded caller-owned signer is available for a real paid production settlement test.
Complete DNS-rebinding prevention is not established: resolver checks do not pin the
TLS connection's destination. Actual payment/infrastructure cost and gross margin are
unknown; telemetry separates estimates from profit. Adoption and repeat usage are unproven.

## 17. EXACT OWNER ACTIONS
For a real settlement test, provide signing authority privately in the caller's own
process and run sdk/examples/outcome-paid.mjs with at least 0.002 USDC on Base. The
example caps one payment at 0.002 USDC and labels it synthetic. Never send a private key
in chat. Directory account action is needed only if an actual publication job reports it.

## 18. COMMERCIAL RISKS THAT STILL EXIST
These outcomes reduce integration work but are copyable; open-source parsers and direct
APIs are strong competitors. No proprietary data or exclusive provider agreement exists.
Missing merchant identifiers, anti-bot pages and public-source changes limit coverage.
Wallet funding may cost more effort than a tiny execution. Fixed micro-prices require
measured volume/cost and repeat paid use; zero-fee public sources do not mean zero cost.

## Time to first value
Known endpoint: 1 request, POST {intent:"demo"}, no setup. Starting from either root:
1 discovery GET + 1 execution POST = 2 XGuard requests. Capability inspection is optional.
Browser assets and optional directory discovery add requests; installation time is excluded.

## Time to first paid result
Known endpoint with funded signer: 1 initial POST/402 + 1 identical paid retry = 2 XGuard
requests, one logical SDK call. Starting at the root adds 1 GET = 3. Wallet setup, funding
and facilitator/RPC traffic are not included. Actual live paid duration remains unmeasured.
