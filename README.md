# XGuard Web Extractor

XGuard is a usage-priced web extraction product for AI agents, RAG pipelines, research automation, and structured ingestion. It converts public web pages into clean Markdown, text, metadata, and normalized links while enforcing hard safety and cost limits.

Production domain retained from the existing system: [https://xguardgate.com](https://xguardgate.com)  
Repository: [https://github.com/moelayyan90/XGuard](https://github.com/moelayyan90/XGuard)

## Primary commercial surfaces

### Apify Store Actor

Source: [`commercial/apify-xguard`](commercial/apify-xguard)

- crawl one page or a same-domain site
- clean boilerplate and convert main content to Markdown
- emit text, title, description, canonical URL, language, links, and metadata
- hard page/content limits
- `$0.004` `page-result` pay-per-event price
- failed, empty, or non-HTML pages do not intentionally emit a billable event

### RapidAPI service

Source: [`commercial/rapidapi-xguard`](commercial/rapidapi-xguard)

- `POST /v1/extract`
- synchronous public-page extraction
- OpenAPI 3.1 definition included
- production requests gated by `X-RapidAPI-Proxy-Secret`
- guarded DNS resolution, redirect validation, private-network blocking, timeout limits, and response-size limits
- billing and consumer authentication delegated to RapidAPI

See [`commercial/README.md`](commercial/README.md) for the commercial architecture.

## Truthful current state

The repository contains deployable source for both commercial surfaces. Marketplace listing, payout configuration, provider-origin assignment, and publication are external account-level operations and are not represented as complete until those platforms confirm them.

## Legacy XGuard infrastructure

The previous autonomous AI inference/x402/Cloudflare implementation is preserved rather than deleted. Existing Worker, gateway, billing, MCP, settlement, CLI, SDK, D1 migrations, and operational tooling remain in the repository for compatibility and future routing use.

Legacy documentation:

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DGRID.md](DGRID.md)
- [PROFIT_MODEL.md](PROFIT_MODEL.md)
- [PAYOUTS.md](PAYOUTS.md)
- [PROVIDERS.md](PROVIDERS.md)
- [SECURITY.md](SECURITY.md)
- [OPERATIONS.md](OPERATIONS.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)

## Existing inference verification

```bash
npm ci --ignore-scripts
npm run inference:verify
```

## Commercial verification

The `Commercial Surfaces` GitHub Actions workflow validates Actor metadata, installs the isolated commercial dependencies, syntax-checks both services, and runs extraction/security tests for the RapidAPI engine.
