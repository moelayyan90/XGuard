# Distribution of executable outcomes

## AUTO-SHIPPABLE NOW

- Outcome pages linked from the homepage, with exact pricing, input/output schemas,
  REST examples and MCP/A2A mappings; only configured, executable capabilities appear.
- Sitemap, robots, canonicals, Schema.org Service data, `/agent.txt`, `llms.txt`, OpenAPI,
  capability JSON index, MCP server card and A2A card describe the same registry.
- Reuse existing repository workflows for official MCP Registry, MCPCentral, IndexNow
  and A2A registration after a successful deployment. A submitted record is not proof
  of indexing, client installation or usage. Verify their actual run results.
- Keep the existing GitHub namespace and public remote MCP URL. Update package/README
  examples to execute a result, and ship a client helper that preserves the signed quote
  during automatic x402 retry without silently spending beyond an explicit budget.

## PAID-AGENT DISCOVERY STATUS (2026-09-14)

The paid `/v1/execute` challenge now carries a validated Bazaar declaration with
public request examples and an output schema. Customer URLs and signed quotes are
excluded from discovery examples. The native x402 MCP transport is exercised with
the official MCP and x402 clients, including payment approval, delivery and replay.
Local settlement fixtures are not paid customer transactions.

This does **not** establish a listing in Coinbase's Bazaar. The configured production
facilitator is `https://facilitator.xpay.sh`; Coinbase documents cataloging after a
successful paid call through the **CDP Facilitator**. It also distinguishes indexing
from ranking and editorial curation. MCP Registry publication is a different surface.
Do not claim Coinbase distribution based on our own manifest or a green MCP workflow.

Coinbase's public validator currently accepts only resource URL and GET/POST method,
without a request body. An empty POST to our intent endpoint is intentionally invalid;
do not weaken input validation or perform a default paid job to satisfy that probe.
`scripts/inspect-buyer-discovery.mjs` reports the external search/validation response,
including unknown status on network errors. It never pays or submits a listing.

Primary sources:
- https://docs.cdp.coinbase.com/x402/seller/get-discovered
- https://docs.cdp.coinbase.com/x402/buyer/mcp-payments
- https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/mcp.md

## X402SCAN BUYER LISTING (2026-09-14)

The public registration form accepted `/v1/execute` and `/v1/tools/web.fetch`.
The resulting buyer page is live:
https://www.x402scan.com/server/594cf7cc-9e89-4c89-9895-7a0895d7ac7d

Its first view showed zero transactions, volume and buyers. Registration is not a
sale. The mainnet fetch resource was priced, but the mixed free/paid outcome
resource was initially classified as Public because its OpenAPI operation omitted
`x-payment-info`. The OpenAPI declaration now supplies x402 pricing bounds, explains
the free preview, and provides a valid paid-intent example for marketplace probes.
No source is fetched and no payment settles when an unsigned probe requests a price.
Runtime input validation, quoted prices and payment authorization remain enforced.

On 2026-09-15 the public form successfully refreshed both mainnet resources. The
buyer page now labels `/v1/execute` as x402 v2 with **Up to < $0.01**, replacing
the earlier Public classification; `/v1/tools/web.fetch` remains priced at < $0.01.
The outcome description displays the sampled feed-digest capability. At that check,
the same page still showed 0 transactions, $0.00 volume and 0 buyers. The application
commercial observer at 09:14:13Z also reported zero settled cash, recognized revenue
and successful paid executions. Neither check is an independent audit of all rails.

The testnet fetch endpoint was not registered because the marketplace supports Base
mainnet and Solana, not Base Sepolia. Forty other endpoints were skipped as
unprotected; these are not forty broken paid products.

Production release evidence:
https://github.com/moelayyan90/XGuard/actions/runs/34839979890
At 2026-09-14T11:48:20Z, Coinbase search returned no matching records with
`partialResults:true`; its empty-POST validator reached our API and received 422.
This is not evidence of a Coinbase listing or an exhaustive absence from its index.

The xpay Tools monetization product is a separate payment proxy requiring publisher
sign-in and receiving-wallet setup. Its documentation does not establish passthrough
compatibility with XGuard's existing native paid challenge. No proxy was published
and no second payment layer was added.

Primary references:
- https://github.com/Merit-Systems/x402scan/blob/main/docs/DISCOVERY.md
- https://docs.xpay.sh/en/tools/publish/register-server
- https://docs.xpay.sh/en/tools/publish/pricing-your-tools

## REQUIRES OWNER ACCOUNT ACTION

- A wallet with usable USDC and signing authority for an external paid settlement test
  if one is not available to the execution environment. Never retrieve arbitrary private
  keys or treat a configured treasury recipient as a payer.
- Registry/directory account verification only if its existing workflow reports that
  authentication or ownership proof is missing. Record the exact failing surface.
- Fund or connect licensed search/OCR/inference providers only if the owner later chooses
  those products. They are not prerequisites for the three public-source outcomes.

## NOT WORTH IT

- Bulk doorway pages, fictional capabilities, fabricated reviews or provider relationships.
- New protocol adapters with no working outcome, or more directories presented as revenue.
- Marketplace listings that need human sales as the core acquisition path.

Primary registry references: https://modelcontextprotocol.io/registry/remote-servers ,
https://modelcontextprotocol.io/registry/authentication ,
https://modelcontextprotocol.io/registry/faq . Metadata is versioned; remote MCP must
be publicly accessible. Registry publication does not force agents to select a server.
