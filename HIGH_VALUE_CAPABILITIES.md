# Outcome selection

Scored before implementation, 2026-09-09. Scores 1–5 are prioritization hypotheses,
not survey findings, sales forecasts or scientifically measured willingness to pay.
Higher is preferable; competition is scored as differentiation headroom.

| Outcome | Frequency | Urgency | DIY difficulty | Payment hypothesis | Agent fit | Automation | Headroom | Low cost | Margin potential | Repeat | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Multi-source product offer normalization | 4 | 4 | 4 | 3 | 5 | 5 | 2 | 5 | 4 | 5 | 41 |
| Multi-page evidence bundle | 5 | 3 | 3 | 3 | 5 | 5 | 2 | 5 | 4 | 5 | 40 |
| Deduplicated RSS/Atom digest with source fallback | 5 | 3 | 3 | 2 | 5 | 5 | 2 | 5 | 4 | 5 | 39 |
| Scoped durable vendor action | 5 | 5 | 4 | 4 | 5 | 5 | 3 | 3 | 4 | 5 | 43 |
| Web-wide verified product search | 4 | 4 | 5 | 4 | 5 | 5 | 2 | 1 | 2 | 5 | 37 |
| Invoice PDF OCR and field extraction | 4 | 4 | 4 | 4 | 5 | 5 | 2 | 1 | 2 | 4 | 35 |

Scoped durable actions have the strongest installed-workflow hypothesis but already
exist and require vendor credentials. Preserve them as an advanced route. The last
two candidates have no funded/licensed production provider and must not be advertised.

## The three anonymous paid experiments

- **web-extraction**: fetch up to three pages with optional explicit backup sources;
  extract titles, descriptions, main text, links and structured data; normalize and
  deduplicate; attach retrieval times and source digests. Value is the complete bundle,
  not HTTP forwarding. Not browser rendering, search, or an LLM summary.
- **product-offers**: visit supplied product pages, extract Schema.org Product/Offer
  JSON-LD, validate amounts/currencies, group offers by explicit product identifiers,
  and return comparable groups plus provenance and missing-data warnings. Never compare
  currencies or different products as if interchangeable. No claim of lowest price on
  the whole web, live stock confirmation or merchant truth verification.
- **feed-digest**: normalize RSS and Atom across supplied feeds or a documented default
  technology source set; use backup endpoints on failure, deduplicate by canonical link,
  sort by published time, preserve source attribution and report incomplete coverage.

Each has a fixed bounded execution price configured in the registry, disclosed in the
402 before payment. Public-source provider fees are zero; infrastructure/payment budgets
are estimates, not actual gross profit. Failed execution credits remain a liability.

The **extract-preview** capability runs the same extraction pipeline on supplied HTML
or labelled sample documents without outbound calls. It is free and does not demonstrate
paid-provider availability, a blockchain settlement, or customer adoption.

## What would falsify the choice

If qualified users prefer direct providers, if the output needs manual cleanup, if paid
completion is poor, or if customers do not repeat, do not add more metadata to compensate.
Use per-capability funnel events and settled-delivery accounting to retire the losing
experiment. Broader source access, licensed data and proprietary workflows remain possible
future differentiators, not capabilities this release claims to own.

Technical references: https://schema.org/Product , https://schema.org/Offer ,
https://www.rssboard.org/rss-specification , https://www.rfc-editor.org/rfc/rfc4287 .
