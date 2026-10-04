# Migration inventory

| Component | Decision | Reason |
|---|---|---|
| Cloudflare Worker and custom domains | Reuse | Existing deployment credentials and serving infrastructure |
| SQLite Durable Object runtime | Extend | Atomic temporal writes and durable source scheduling |
| Existing financial namespaces/migrations/classes | Preserve | Pending obligations, result recovery and reconciliation |
| Historical receipts and ProofRail | Preserve separately | Integrity proofs do not establish factual truth |
| Network policy | Reuse and bound | Official host allowlist plus public DNS/redirect/body checks |
| Existing CI, CodeQL and lifecycle guard | Reuse | Tested deployment with state-safe recovery |
| New Live classes | Add in isolated migration | Never combine durable lifecycle changes with runtime switch |
| Apex/www/API public positioning | Replace | One canonical facts product and redirects |
| Marketplace, seller onboarding, paid extraction, MCP/A2A discovery | Retire public routes | Remove conflicting business model; return 410 |
| Old marketing/install/package manifests | Archive under docs/legacy | Preserve history without representing current installation requirements |
| Old publisher, marketplace monitor and SDK release workflows | Archive | Stop obsolete advertising and production contract checks |
| Billing readiness and financial regression tests | Keep | Existing obligations must remain protected |
| Data collection and refresh | New | Deterministic official adapters, conditional fetches, domain leases, immutable evidence |
| Public facts/history/topic/change pages | New | HTML, Markdown, JSON, robots, segmented sitemaps, JSON-LD and Atom |
| Owner controls and analytics | New | Protected operations, correction review, claimed vs verified crawlers |
| Cloudflare monetization | Prepared, observe mode | Account eligibility and actual buyer participation are external facts |

The deployment does not erase existing records or falsely backfill observation history. New counts start from actual successful collection. Large-scale capacity and commercial demand are not claimed from fixtures. Invoices, independent crawler demand and provider revenue must be observed after launch.
