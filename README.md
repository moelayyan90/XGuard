# XGuard Child Safety Control Layer

[![CI](https://github.com/moelayyan90/XGuard/actions/workflows/ci.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/ci.yml)
[![CodeQL](https://github.com/moelayyan90/XGuard/actions/workflows/codeql.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/codeql.yml)
[![Mainnet](https://github.com/moelayyan90/XGuard/actions/workflows/deploy-mainnet.yml/badge.svg)](https://github.com/moelayyan90/XGuard/actions/workflows/deploy-mainnet.yml)

**XGuard is a commercial child-safety infrastructure layer for online platforms, games, communities, schools, telecom products, ad-tech and public-sector child-protection programmes.**

The product is designed to sit inside an integrated service and return an enforceable decision before or during delivery of risky content or contact involving children and minors.

## Core control contract

Every analyzed safety event receives a risk level and a primary control:

```text
ALLOW
WARN
BLUR
BLOCK
FREEZE_CHAT
ESCALATE
```

The host platform can use the returned enforcement object to:

- block a message or content item;
- blur age-inappropriate media;
- freeze a risky conversation;
- prevent further contact;
- suppress a sexualized advertisement;
- disable autoplay for risky content;
- require human safety review;
- surface a reporting flow;
- preserve evidence on the client/platform side when a critical incident is detected.

XGuard does not remotely shut down conversations, accounts, videos or advertisements on third-party products that have not integrated XGuard. It provides the decision and control layer; the integrated host enforces it.

## Risks XGuard evaluates

The first classifier is designed around risks such as:

- grooming;
- sexual solicitation;
- requests for intimate or sexual images;
- coercion and sextortion;
- secrecy manipulation;
- age-inappropriate contact;
- attempts to move a minor into private/off-platform channels;
- pressure to meet in person;
- explicit sexual content;
- sexualized advertising;
- harassment.

## Risk Session

A single message may look harmless while the sequence is dangerous.

XGuard supports an optional `riskSessionId` so the system can recognize a pattern such as:

```text
secrecy
  -> move to a private channel
  -> request intimate imagery
  -> coercion / sextortion
```

The session identifier is hashed before persistence. XGuard stores risk metadata and the hash, not the raw child conversation body in the child-safety scan ledger.

Repeated HIGH/CRITICAL signals in the same session increase the enforcement level of later risky events.

## Commercial model

The child-safety product is billed **per analyzed safety event** from the existing XGuard prepaid merchant balance.

Initial prices:

| Event                   |  Price |
| ----------------------- | -----: |
| Single message          | $0.005 |
| Chat window             | $0.010 |
| Ad text                 | $0.010 |
| Image-description event | $0.015 |
| Video-transcript event  | $0.020 |

The event id is idempotent per merchant. Retries do not create duplicate scan charges.

A fee is held before classification, earned after a successful persisted safety decision, and released if classification fails.

## API

```text
GET  /v1/child-safety/catalog
GET  /v1/child-safety/reporting?country=<country>
POST /v1/child-safety/scan
```

Paid scans use the existing XGuard merchant authentication:

```text
Authorization: Bearer <XGuard merchant API key>
```

Example:

```json
{
  "eventId": "msg:platform:12345678",
  "riskSessionId": "conversation:98765432",
  "contentKind": "message",
  "language": "Arabic",
  "childLikely": true,
  "childAgeBand": "13-15",
  "text": "...message supplied by the integrated platform...",
  "signals": ["adult-minor age gap", "new contact"]
}
```

See [Child Safety](docs/CHILD_SAFETY.md) and the machine-readable [Child Safety OpenAPI](docs/child-safety-openapi.yaml).

## Global reporting router

XGuard does not invent hotline numbers.

`GET /v1/child-safety/reporting?country=<country>` returns a locally verified contact when a current country pack exists and always returns official global routing sources, including:

- Child Helpline International — country-by-country child helplines;
- INHOPE — country-based reporting routes for suspected child sexual abuse material;
- NCMEC CyberTipline — suspected child sexual exploitation reporting with international referrals.

When a direct country number is not verified in XGuard, the API deliberately returns the official global country selectors instead of a guessed number.

## Privacy boundary

The MVP child-safety ledger does not persist raw submitted child messages or raw content.

Stored safety data is limited to operational metadata such as:

- merchant;
- external event id;
- hashed risk-session id;
- content kind;
- risk level;
- risk categories;
- enforcement action;
- charged amount;
- timestamp.

A future evidence vault or forensic workflow requires a separate legal, retention and security design. XGuard must not silently become a general-purpose surveillance product.

## Current media boundary

The initial API analyzes:

- message text;
- chat windows;
- advertisement text;
- image-description events;
- video transcripts.

Direct raw-image/video decoding, key-frame extraction, audio transcription, perceptual-hash matching and specialist CSAM hash-list integration are **not yet implemented in this endpoint**.

That boundary is deliberate. XGuard must not claim to identify known CSAM from raw media until an authorized detection source or hash programme, required reporting obligations and media-processing pipeline are in place.

## Why companies may need this layer

Child-accessible online services increasingly face explicit duties and regulator scrutiny around protection from grooming, harmful content, unwanted contact, age-inappropriate content and child-targeted advertising.

XGuard is intended to package those controls into one programmable layer that can be measured, audited and enforced consistently across chat, content and advertising surfaces.

## Existing payment/protocol infrastructure

The repository retains XGuard's earlier payment-control, x402, MCP, A2A, webhook, discovery and settlement-safety infrastructure. It now serves as reusable billing, API and compatibility plumbing rather than the primary product identity.

Existing machine/developer surfaces remain available, including:

```text
/.well-known/xguard/payment-layer.json
/.well-known/xguard/protocols.json
/.well-known/mcp/server.json
/.well-known/agent-card.json
/openapi.json
/mcp
```

The current remote MCP surface exposes these five tools:

- `xguard_payment_offer`
- `xguard_payment_decision`
- `xguard_discover`
- `xguard_resource_details`
- `xguard_status`

The legacy x402 adapter continues to handle Base-mainnet native USDC settlement safety independently of the child-safety product.

For protocol-specific facilitator behavior, see [facilitators](docs/FACILITATORS.md).

## Development and verification

```bash
npm run check
npm run verify:release
npm --workspace @xguard/worker run build:mainnet
```

## Documentation

[Child Safety](docs/CHILD_SAFETY.md) · [Child Safety OpenAPI](docs/child-safety-openapi.yaml) · [Quickstart](QUICKSTART.md) · [API](docs/API.md) · [facilitators](docs/FACILITATORS.md) · [Security](SECURITY.md) · [Threat Model](THREAT_MODEL.md) · [Architecture](ARCHITECTURE.md) · [Operations](OPERATIONS.md) · [Deployment](DEPLOYMENT.md)

XGuard is an independent project and is not an official product of Child Helpline International, INHOPE, NCMEC, INTERPOL, any government, Coinbase, Cloudflare, Base, Circle, x402 Foundation, Google, Microsoft or any other third party unless an explicit agreement states otherwise.

Apache-2.0. See [CONTRIBUTING.md](CONTRIBUTING.md).
