# XGuard Child Safety Control Layer

XGuard is being repositioned as a commercial child-safety infrastructure layer for online platforms, games, communities, schools, telecom products, ad-tech systems and public-sector child-safety programmes.

The core product is not passive advice. It is a real-time safety decision API that an integrated product can call before or during delivery of a message, chat window, ad, image-derived signal or video transcript.

## Core decision contract

Every analyzed event receives a risk result and an enforcement recommendation:

- `ALLOW`
- `WARN`
- `BLUR`
- `BLOCK`
- `FREEZE_CHAT`
- `ESCALATE`

The host product is responsible for enforcing the returned control. XGuard cannot remotely close a conversation, video, account or advertisement on a third-party service that has not integrated XGuard.

## Risks detected

The first classifier is designed to identify or escalate signals associated with:

- grooming;
- sexual solicitation;
- explicit sexual content;
- requests for sexual or intimate imagery;
- coercion and sextortion;
- secrecy manipulation;
- age-inappropriate contact;
- attempts to move a child to a private or off-platform channel;
- pressure to meet in person;
- sexualized advertising;
- harassment.

## Risk Session

A single message can look harmless while a sequence is dangerous. XGuard therefore supports an optional `riskSessionId`.

The value is hashed before persistence. The child-safety ledger stores the hash and risk metadata, not the raw conversation body. Recent HIGH/CRITICAL events in the same risk session increase the enforcement level for later risky events.

A typical progression can therefore be detected as a pattern:

`secrecy -> private channel -> intimate image request -> coercion`

The control layer can escalate from warning to blocking to conversation freeze as the pattern accumulates.

## Privacy boundary

The MVP intentionally does not store raw child messages or raw content in `child_safety_scans`.

Stored fields include:

- merchant;
- external event id;
- hashed risk-session id;
- content kind;
- risk level;
- enforcement action;
- risk-category labels;
- charged amount;
- timestamp.

A future evidence-preservation product requires a separate legal, security and retention design. XGuard must not silently become a general-purpose surveillance system.

## Billing

XGuard is commercial infrastructure. API clients prepay the existing XGuard merchant balance and pay per analyzed safety event.

Initial prices:

| Event | Price |
| --- | ---: |
| Single message | $0.005 |
| Chat window | $0.010 |
| Ad text | $0.010 |
| Image-description event | $0.015 |
| Video-transcript event | $0.020 |

The event id is idempotent per merchant so network retries do not create duplicate scan charges.

The fee is held before AI execution, earned after a successful persisted decision, and released if classification fails.

## Global reporting router

`GET /v1/child-safety/reporting?country=<country>` returns locally verified direct contact information when XGuard has a current country pack. It always includes official global routing sources:

- Child Helpline International: `https://childhelplineinternational.org/helplines/`
- INHOPE: `https://www.inhope.org/`
- NCMEC CyberTipline: `https://report.cybertip.org/`

Child Helpline International maintains child-helpline members across more than 130 countries and territories. INHOPE maintains a global network for reporting suspected child sexual abuse material. NCMEC's CyberTipline is used for suspected child sexual exploitation and refers reports internationally.

XGuard must not invent a local emergency, police or helpline number. If a country pack is absent or stale, the product must route the user to an official country selector instead.

## Enforcement examples

### Critical grooming / sextortion risk

```json
{
  "riskLevel": "CRITICAL",
  "primaryAction": "FREEZE_CHAT",
  "enforcement": {
    "blockContent": true,
    "freezeConversation": true,
    "preventFurtherContact": true,
    "requireHumanSafetyReview": true,
    "surfaceReportFlow": true,
    "preserveClientSideEvidence": true
  }
}
```

### Sexualized ad shown in a child context

```json
{
  "riskLevel": "HIGH",
  "primaryAction": "BLOCK",
  "enforcement": {
    "blockContent": true,
    "suppressAd": true,
    "requireHumanSafetyReview": true
  }
}
```

## API

### Catalog

`GET /v1/child-safety/catalog`

Returns pricing, supported content kinds, categories and enforcement actions.

### Reporting directory

`GET /v1/child-safety/reporting?country=Jordan`

Returns a locally verified child-help contact when present plus the global official routing sources.

### Scan

`POST /v1/child-safety/scan`

Authentication:

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
  "text": "...message body supplied by the integrated platform...",
  "signals": ["adult-minor age gap", "new contact"]
}
```

## Current media boundary

The initial Worker accepts text, chat windows, ad text, image-description events and video transcripts. Direct raw image/video decoding, key-frame extraction, audio transcription, perceptual-hash matching and specialist CSAM hash-list integration are separate media-pipeline work and are not yet implemented by this endpoint.

This distinction matters: XGuard must not claim to identify known CSAM from raw media until it is connected to an authorized detection source or hash programme and the necessary legal/reporting obligations are implemented.

## Product roadmap

1. Real-time text/chat safety API.
2. Risk-session graph and repeat-contact escalation.
3. Raw image and video safety pipeline.
4. Ad-creative moderation API.
5. Platform SDKs that enforce `BLOCK`, `BLUR` and `FREEZE_CHAT` locally.
6. Country Packs for child helplines, cybercrime reporting and statutory reporting rules.
7. Authorized ESP reporting connectors where credentials/agreements exist.
8. Compliance dashboards and auditable child-risk assessments for regulated platforms.
