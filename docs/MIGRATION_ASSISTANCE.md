# XGuard Migration Assistance

XGuard Migration Assistance is a multilingual administrative-assistance layer for migrants, refugees, asylum seekers, displaced people, students, workers, family migrants, and people without regular immigration documentation.

The product is designed to reduce language, paperwork, navigation, and completeness friction without pretending to be a government authority or a law firm.

## Product contract

A user should be able to tell XGuard where they are, their situation, the language they need, and what they are trying to accomplish. XGuard can then help them understand supplied official communications, translate supplied text, organize a document packet, compare a file against supplied requirements, and produce a source-grounded action plan.

XGuard must never manufacture a legal rule, deadline, government office, document, fact, signature, identity, asylum story, or supporting evidence.

## People served

The product is available to:

- refugees;
- asylum seekers;
- displaced people;
- regular migrants;
- work and study migrants;
- family migrants;
- people who are undocumented or in an irregular immigration status;
- people who are unsure of their current status.

Undocumented or irregular status does not remove access to neutral information about rights, protection, asylum, legal aid, or lawful regularization pathways. XGuard does not provide instructions for unlawful border crossing, evading authorities, forged documents, false declarations, sham relationships, or destruction/concealment of evidence.

## Operations

Paid operations use a fixed USD anchor price of **USD 3.00 per completed operation**:

- `explain_letter`
- `translate_document`
- `prepare_document_packet`
- `check_completeness`
- `build_personalized_plan`

First-line protection and legal-aid routing remain free:

- `find_official_help`
- `safety_and_legal_aid`

The price is represented internally as `3_000_000` micro-USD. A paid operation reserves the fee before generation, earns it only after successful completion, and releases the reservation if generation fails. Stable operation IDs prevent retry-based double charging.

## Local currencies

USD 3.00 is the pricing anchor. XGuard must not hardcode exchange rates.

For public worldwide checkout, the connected payment service provider must quote and collect the live local-currency equivalent at checkout. The current bootstrap payment rail is the existing Buyer Pass prepaid balance funded with Base-mainnet native USDC.

**This means worldwide card/local-currency checkout is not complete yet.** It requires a compatible payment provider/account and checkout integration. The product must not claim otherwise.

## Source-grounded country guidance

Country-specific legal and administrative plans are fail-closed.

`build_personalized_plan` requires verified official-source excerpts (or, in a later phase, a verified Country Pack). If the request does not contain sufficient official grounding, XGuard returns `verified_official_source_required` instead of guessing from model memory.

The initial global official-help anchors are:

- UNHCR Help — `https://help.unhcr.org/`
- UNHCR — `https://www.unhcr.org/`
- IOM — `https://www.iom.int/`

These are starting points, not a substitute for the responsible national authority.

## Translation boundary

AI-generated translation is informational. When a government, court, school, employer, embassy, or other competent body requires a certified, sworn, or authorized translation, XGuard must tell the user and route them to a qualified provider rather than label an AI translation as certified.

## API

### Catalog

`GET /v1/migration/catalog`

Returns supported paid/free operations and the USD 3.00 pricing contract.

### Official-help anchors

`GET /v1/migration/official-help`

Returns global official-help starting points and the source-verification warning.

### Quote

`POST /v1/migration/quote`

Example:

```json
{
  "operation": "translate_document"
}
```

### Assistance

`POST /v1/migration/assist`

Paid requests require:

- `Authorization: Bearer <Buyer Pass>`
- `X-XGuard-Operation-Id: <stable 16-100 character id>`

Example payload:

```json
{
  "operation": "explain_letter",
  "language": "Arabic",
  "currentCountry": "Germany",
  "migrationStatus": "Asylum seeker",
  "goal": "Understand what this letter requires",
  "text": "...official letter text..."
}
```

For a source-grounded personal plan, supply official excerpts:

```json
{
  "operation": "build_personalized_plan",
  "language": "Arabic",
  "currentCountry": "Germany",
  "migrationStatus": "Asylum seeker",
  "goal": "Understand the next administrative steps",
  "officialSources": [
    {
      "title": "Responsible authority guidance",
      "url": "https://official.example/...",
      "excerpt": "Relevant verified excerpt..."
    }
  ]
}
```

## Privacy posture for the MVP

The migration assistance endpoint does not write the submitted document text into XGuard application storage. Billing records store the operation ID, principal, operation type, amount, state, and timestamps—not the document body.

This is an MVP posture, not a complete global privacy/compliance program. Before broad public launch, XGuard still needs jurisdiction-specific privacy review, retention policy, data-subject workflows, processor agreements, and security review for any future document vault.

## Current MVP boundaries

The first implementation supports pasted text and supplied requirement/source excerpts. It does not yet provide:

- raw PDF/image document upload and extraction;
- certified translation fulfillment;
- a worldwide verified Country Pack database;
- live government form submission;
- live government case-status integration;
- global card/local-payment checkout;
- licensed legal representation;
- a persistent sensitive-document vault.

These boundaries are deliberate. XGuard should add each capability only after its source, legal authority, provider, payment, and privacy requirements are clear.

## Next product layers

1. **Country Packs** — versioned, source-cited rules, forms, authorities, deadlines, and requirements by country/status/event.
2. **Document intake** — secure image/PDF ingestion, extraction, classification, and completeness checks.
3. **Provider routing** — certified translators and authorized legal-assistance providers where needed.
4. **Local checkout** — cards and supported local payment methods with provider-quoted FX.
5. **Government/NGO integrations** — only through official APIs, agreements, procurement, or authorized partner channels.
