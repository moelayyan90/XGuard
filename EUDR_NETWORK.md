# XGuard EUDR Inbox

## Product

XGuard is being repositioned as an independent supplier-to-buyer EUDR reference exchange and readiness layer.

Core message:

> **90% is readiness. The final 10% is execution.**

The statement is a product positioning principle, not a legal or statistical claim. The readiness score in the product is explicitly composed of nine pre-transaction operational checks worth 10 percentage points each. The final 10 percentage points represent live transaction execution once a real EUDR movement exists.

## Default workflow

```text
Buyer / ERP / customs workflow
        |
        v
XGuard EUDR Inbox
        |
        +--> supplier receives one structured handoff path
        |
        +--> DDS reference intake
        +--> shipment/reference deduplication
        +--> timestamped evidence hash
        +--> readiness status
        |
        v
External EUDR verification / filing capability
        |
        v
Customer operational record
```

The commercial objective is to become the default operational handoff selected by participating buyers, ERPs, brokers and sector platforms. XGuard must never claim that EU law requires use of XGuard specifically.

## Distribution loop

1. A buyer creates an XGuard EUDR Inbox.
2. The buyer instructs suppliers to send requested EUDR references through that Inbox.
3. Supplier reference intake is free.
4. Suppliers experience XGuard as part of a customer-required operational process.
5. Suppliers that themselves need EUDR workflow can create their own Inbox or purchase downstream verification/submission services.
6. ERP/customs partners can embed XGuard as the default EUDR handoff for their customers.

This creates a buyer -> supplier -> supplier's suppliers network effect without requiring paid referrals or deceptive claims.

## Incentives

### Buyers
- Free inbound reference intake.
- Structured alternative to email/spreadsheet collection.
- Timestamped evidence receipts and duplicate prevention.
- Data portability; no artificial lock-in.

### Suppliers
- No charge merely to send a requested reference.
- One repeatable handoff format.
- Immediate receipt proving what was submitted and when.

### ERP / customs / platform partners
- Free integration/pilot setup where operationally feasible.
- Partner revenue share can be negotiated on paid downstream services.
- No need to charge the partner for raw inbound reference intake.
- XGuard is designed to sit behind the partner brand or workflow if required.

## Monetisation

Free:
- public Inbox receipt surface;
- inbound DDS-reference intake;
- duplicate protection;
- readiness scoring;
- basic receipt/evidence hash.

Paid once implemented and independently validated:
- external DDS verification;
- EUDR submission orchestration;
- exception handling/retry orchestration;
- structured archive/export services;
- enterprise API/ERP automation where it creates measurable operational value.

Do not charge for a capability that is not actually performed.

## Revenue target math

The owner's commercial target is **USD 400/day**, but this is a target, not a guarantee.

Illustrative gross-revenue thresholds before processing costs, taxes, partner share and other expenses:

- $5 earned service revenue per paid event -> 80 paid events/day.
- $4 per paid event -> 100 paid events/day.
- $3 per paid event -> 134 paid events/day (rounded up).
- $2 per paid event -> 200 paid events/day.

The preferred acquisition route is therefore one or a few high-volume partners, not hundreds of one-off direct customers.

## Commercial guardrails

- Never describe XGuard as legally mandatory.
- Never imply affiliation with the European Commission, TRACES, an EU competent authority, customs authority or certification scheme.
- Do not claim a DDS is verified until an actual authoritative verification operation has succeeded.
- Do not store plaintext payment secrets or unnecessary sensitive credentials.
- Keep free supplier intake free; monetise verified value-producing actions.
- Every partner incentive must remain transparent and contractual.
- Revenue-share arrangements must not distort or misstate legal compliance obligations.

## Readiness framework

The current readiness endpoint uses nine pre-transaction checks:

1. scope mapped;
2. legal/operational roles confirmed;
3. suppliers mapped;
4. CN/product codes mapped;
5. geolocation data ready;
6. source data mapped;
7. retention policy ready;
8. EU-system credentials ready;
9. test flow completed.

When all nine are complete, XGuard reports 90% operational readiness. The final 10% is reserved for live transaction execution; this preserves the product message without pretending readiness equals legal compliance.
