# XGuard Commercial Surfaces

XGuard's primary commercial product is now a usage-priced web extraction engine for AI agents, RAG pipelines, research automation, and data ingestion.

## Surfaces

### Apify

Path: `commercial/apify-xguard`

- multi-page crawling
- clean Markdown/text/metadata/links
- pay-per-event billing
- `$0.004` per successfully stored page
- no billable event for failed, empty, or non-HTML pages

### RapidAPI

Path: `commercial/rapidapi-xguard`

- synchronous `POST /v1/extract`
- RapidAPI-managed consumer authentication/billing
- provider proxy-secret enforcement
- guarded DNS resolution and redirect validation
- hard content and timeout limits

## Product rule

Revenue must be associated with a successful usable output. Failed work is not intentionally billed by XGuard's application layer.

## Legacy system

The existing Cloudflare/x402/inference code is intentionally preserved. It remains available for compatibility and future routing opportunities, but it is no longer the primary commercial proposition in the repository.
