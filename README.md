# XGuard Migration Assistance

[![CI](https://github.com/moelayyan90/XGuard/actions/workflows/ci.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/ci.yml)
[![CodeQL](https://github.com/moelayyan90/XGuard/actions/workflows/codeql.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/codeql.yml)
[![Mainnet](https://github.com/moelayyan90/XGuard/actions/workflows/deploy-mainnet.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/deploy-mainnet.yml)

**XGuard is a multilingual practical-assistance platform for migrants, refugees, asylum seekers, displaced people, regular migrants, and people without regular immigration documentation.**

The product goal is simple: help a person understand what an official document says, organize what they need, identify missing items, translate supplied text, find lawful help, and follow a source-grounded administrative path in the language they understand.

XGuard is not a government authority, law firm, or licensed legal representative. It does not create false evidence, false declarations, forged documents, evasion instructions, or unlawful border-crossing guidance.

## What XGuard does

The first migration-assistance surface supports:

- **Explain an official letter** — turn difficult administrative language into clear, practical meaning;
- **Translate document text** — provide an informational translation in the language the user requests;
- **Prepare a document packet** — organize supplied material and distinguish supplied, missing, unclear, and certified/legal-handling items;
- **Check completeness** — compare a file against requirements supplied from an authority or verified source;
- **Build a personalized plan** — only when country-specific requirements are grounded in verified official-source excerpts;
- **Find official help** — free first-line routing to protection and official assistance starting points;
- **Safety and legal-aid routing** — free first-line support for users who need qualified or urgent legal/protection help.

The user-facing portal is served from `/`, `/migration`, `/help`, and `/app` by the mainnet Worker entrypoint.

## Who XGuard serves

XGuard is designed for people regardless of whether their current immigration status is clear or regular, including:

- refugees;
- asylum seekers;
- displaced people;
- work migrants;
- students;
- family migrants;
- undocumented people and people in irregular immigration status;
- users who are unsure which category describes them.

People without regular status can still receive neutral information about rights, protection, asylum, legal aid, and lawful regularization pathways. XGuard does not provide instructions to hide from authorities, evade enforcement, falsify a case, destroy evidence, or cross a border unlawfully.

## Pricing

Paid migration-assistance operations have one anchor price:

**USD 3.00 per completed paid operation** (`3_000_000` micro-USD).

The charging model is completion-based:

1. XGuard reserves USD 3.00 before the paid operation executes.
2. If the operation succeeds, the reservation becomes earned revenue.
3. If generation fails, the reservation is released.
4. A stable `X-XGuard-Operation-Id` prevents retry-based double charging.

First-line protection and legal-aid routing remain free.

### Local-currency pricing

USD 3.00 is the canonical anchor. XGuard does **not** hardcode exchange rates. A connected checkout/payment provider must calculate and collect the live local-currency equivalent at checkout.

The existing bootstrap rail uses a Buyer Pass prepaid balance funded with Base-mainnet native USDC. **Worldwide card and local-currency checkout is not yet complete** and must not be marketed as complete until a compatible provider/account is connected.

## Source-grounded immigration guidance

XGuard fails closed for country-specific rules.

The model is not allowed to invent immigration law, deadlines, eligibility, government offices, required documents, forms, or procedures from memory. The `build_personalized_plan` operation requires verified official-source excerpts. If sufficient grounding is absent, the API returns `verified_official_source_required` instead of guessing.

Initial global official-help anchors include:

- UNHCR Help — `https://help.unhcr.org/`
- UNHCR — `https://www.unhcr.org/`
- IOM — `https://www.iom.int/`

Country Packs will later add versioned, source-cited national rules, responsible authorities, forms, deadlines, and requirements.

## Translation boundary

XGuard translations are informational. If a competent authority requires a certified, sworn, or authorized translation, XGuard must say so and route the user to a qualified provider rather than present AI output as certified.

## API

```text
GET  /v1/migration/catalog
GET  /v1/migration/official-help
POST /v1/migration/quote
POST /v1/migration/assist
```

Paid assistance requests require:

```text
Authorization: Bearer <Buyer Pass>
X-XGuard-Operation-Id: <stable operation id>
```

Example:

```json
{
  "operation": "explain_letter",
  "language": "Arabic",
  "currentCountry": "Germany",
  "migrationStatus": "Asylum seeker",
  "goal": "Understand what this official letter asks me to do",
  "text": "...official letter text..."
}
```

See [Migration Assistance](docs/MIGRATION_ASSISTANCE.md) for the product contract and current boundaries.

## Privacy posture

The migration-assistance endpoint does not persist the submitted document text in XGuard application storage. Billing records contain operation/accounting metadata rather than the body of the user's document.

This is only the MVP privacy posture. A future persistent document vault requires jurisdiction-specific privacy review, retention/deletion rules, data-subject workflows, processor agreements, access controls, and security testing before public deployment.

## Current launch boundaries

The first implementation does not yet claim:

- worldwide verified immigration-law coverage;
- raw PDF/image document upload and extraction;
- certified translation fulfillment;
- licensed legal representation;
- live government form submission;
- live government case-status access;
- universal card/local-payment checkout;
- a persistent sensitive-document vault.

Those capabilities are intentionally gated until the necessary official sources, providers, agreements, payment rails, and privacy controls exist.

## Architecture

The migration product is routed through `apps/worker/src/universal-mainnet.ts` and implemented in `apps/worker/src/migration-assistance.ts`.

Main components:

```text
User
  -> XGuard Migration Portal / API
  -> status + language + goal context
  -> verified-source gate for country-specific rules
  -> multilingual assistance model
  -> document/plan result
  -> completion-based USD 3 accounting for paid operations
```

Migration billing uses dedicated `migration_operation_charges` and `migration_usage_events` tables while reusing the existing XGuard principal balance and ledger infrastructure.

## Existing payment/protocol infrastructure

The repository retains XGuard's earlier payment-control, x402, MCP, A2A, webhook, discovery, and settlement-safety infrastructure. It now serves as reusable infrastructure and compatibility surface rather than the primary product identity.

Existing machine/developer surfaces remain available, including:

```text
/.well-known/xguard/payment-layer.json
/.well-known/xguard/protocols.json
/.well-known/mcp/server.json
/.well-known/agent-card.json
/openapi.json
/mcp
```

The legacy x402 adapter continues to handle Base-mainnet native USDC settlement safety and recovery independently of the migration-assistance product.

## Development and verification

```bash
npm run typecheck
npm test
npm run lint
npm run check
npm --workspace @xguard/worker run build:mainnet
```

## Documentation

[Migration Assistance](docs/MIGRATION_ASSISTANCE.md) · [Security](SECURITY.md) · [Threat Model](THREAT_MODEL.md) · [Architecture](ARCHITECTURE.md) · [Operations](OPERATIONS.md) · [API](docs/API.md) · [Deployment](DEPLOYMENT.md)

XGuard is an independent project and is not an official product of UNHCR, IOM, any government, Coinbase, Cloudflare, Base, Circle, x402 Foundation, or any other third party unless an explicit agreement states otherwise.

Apache-2.0. See [CONTRIBUTING.md](CONTRIBUTING.md).
