# XGuard Web Extractor — Apify

XGuard converts public web pages into compact Markdown, clean text, metadata, and normalized links for LLM, RAG, agent, and research pipelines.

## Commercial model

The Actor uses Apify pay-per-event billing.

- Event: `page-result`
- Price: **$0.004 per successfully stored page**
- Failed requests: **not charged**
- Empty/non-HTML pages: **not charged**

The charge event is emitted through `Actor.pushData(result, 'page-result')`, so a billable event is tied to a result stored in the run dataset.

## Input

```json
{
  "startUrls": [{ "url": "https://example.com" }],
  "maxPages": 100,
  "sameDomain": true,
  "followLinks": true,
  "includeLinks": true,
  "maxContentChars": 200000
}
```

## Output

Each successful item contains:

- final URL and HTTP status
- title, description, language, canonical URL
- clean Markdown
- clean text
- normalized links
- extraction timestamp and schema version

## Safety and cost controls

- HTTP/HTTPS only
- obvious private, loopback, link-local, multicast, and internal destinations blocked
- page cap per run
- content-size cap
- non-HTML responses skipped
- request timeout and retry limit
- charges occur only for stored successful results

## Local run

```bash
npm install
npm start
```

Apify local input is read from its normal Actor storage input. The source directory can be selected directly from this monorepo when creating an Actor from GitHub.
