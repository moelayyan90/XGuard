# XGuard Extract

One paid product reuses the existing bounded public-source extraction engine,
x402 verification/settlement, durable idempotency, receipts and recovery ledger.

- Landing/checkout: https://xguardgate.com/extract
- API: POST https://api.xguardgate.com/api/paid/v1/extract
- Price: 12,000 atomic USDC (0.012 USDC) per request for 1–3 public URLs.
- Discovery: OpenAPI, the existing MCP endpoint (`xguard.extract`), llms.txt,
  the sitemap, GitHub documentation and `/.well-known/x402`.
- Output: main text, title, description, links, structured-data type names,
  duplicate grouping, source hashes/timestamps and explicit coverage.
- Limits: 128 KiB source input per page; up to 6,000 extracted text characters;
  bounded output. No JavaScript rendering, login, web search, proxy rotation or
  access-control bypass. Source claims are untrusted.

## Payment and delivery

The initial unsigned request returns 402. It cannot fetch buyer-supplied URLs.
The buyer must preserve the original body, Idempotency-Key and X-XGuard-Quote.
The official x402 client creates an exact Base USDC authorization. Verification
and settlement precede source execution. Receipts cover the delivered JSON bytes.
The browser verifies the signed delivery before marking it complete.

The browser stores a prepared authorization before transmitting it. Recovery or
an explicit identical resend never creates another signature. If every source
fails after settlement, the original operation receives an execution credit;
the browser can retry that same operation without another payment. Partial
source success is a delivered coverage report, not a complete-source guarantee.
No automatic cash refund is promised.

## Accounting

`/admin/paid-revenue` remains owner-authenticated. It includes extraction attempts,
HTTP outcomes, confirmed external USDC settlement, signed delivery and a rolling
31-event-day UTC accounting history. An unpaid quote, crawler visit, internal
request, synthetic test or owner self-payment is not independent revenue.
Costs and actual net profit remain unknown until reconciled against invoices.

## Release and rollback

1. Deploy reader version 4 while write version remains 3 and extraction is absent
   from LIVE_PAID. Confirm the supporting version is active.
2. Add EXTRACT_SERVICE to LIVE_PAID and set write version 4. Use the existing
   candidate override, unsigned probes and compatible gradual rollout.
3. Roll activation back only to the deployed reader version 4. Returning to a
   reader version 3 after extraction purchases would break outstanding recovery.
   Keep Cloudflare bindings, migrations, secrets and existing records intact.

## Demand evidence and limits

The market test is public web extraction for software/AI workflows, not selling
free package facts. Official adjacent evidence checked on 2026-11-06:

- https://www.firecrawl.dev/pricing — paid web-data plans; entry monthly price
  listed at $19 for 5,000 credits. Capability and credit costs vary by endpoint.
- https://www.firecrawl.dev/customers — first-party named customer stories and
  examples of live website/document ingestion.
- https://cloud.browserless.io/about — vendor reports over 10,000 paying customers.
- https://cloud.browserless.io/pricing — browser infrastructure is sold in paid
  usage plans; a stronger capability set than this bounded static-page service.

These sources establish a paid adjacent category. They do not establish demand
for XGuard, a unique monopoly, conversion, or a date for the first customer.
At 0.012 USDC and a configured 0.0015 infrastructure budget, the illustrative
contribution is 0.0105 USDC/request before actual invoice reconciliation. Reaching
400 USDC/day of that illustrative contribution requires 38,096 paid requests/day;
1,000 requires 95,239. These are required volumes, not forecasts or measured profit.
No paid advertising, new subscription, funded test or wallet transfer is authorized
by the implementation itself. OKX account ownership/support remains unverified;
the existing receiving address is unchanged.
