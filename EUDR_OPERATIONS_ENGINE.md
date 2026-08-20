# XGuard EUDR Operations Engine

## Product thesis

XGuard must not be another EUDR dashboard. The product should behave like an external EUDR operations desk that removes repeated work from the company.

Core promise:

> Enter or connect the data once. XGuard prepares the company before the shipment, chases missing inputs, validates the evidence package, assembles the due-diligence case, submits when authorised and technically ready, reconciles the EU response, distributes the resulting reference, and preserves the audit record.

The legally responsible operator/trader remains responsible for its obligations. XGuard must not claim to replace legal accountability.

## Why this is a real operational problem

Under the EUDR, an operator's due-diligence process includes information collection, risk assessment and, where necessary, risk mitigation. Operators must maintain a due-diligence system and keep required information and updates for five years. The EU Information System supports automated bulk management through webservices/API, but production access requires the applicable EU onboarding/conformance process.

## One input -> many outputs

The competitive advantage is not the number of screens. It is that the same supplier/product/plot/evidence data is reused across the entire workflow.

### 1. Readiness Autopilot

Before a live shipment exists, XGuard prepares the account:

- determine operational role and relevant scope;
- map products/CN codes and commodities;
- map suppliers and expected origins;
- identify required geolocation/evidence fields;
- map EU Information System credentials and authorised users;
- test the future submission path;
- calculate operational readiness.

Product message: **90% is readiness. The last 10% is live execution.** This is a XGuard readiness framework, not a legal/statistical claim.

### 2. Supplier Concierge

XGuard performs supplier chasing instead of the buyer's team:

- magic-link supplier intake;
- multilingual structured requests;
- automatic reminders for missing fields;
- request only the fields relevant to that supplier/product;
- accept CSV/GeoJSON/KML/structured uploads where supported;
- record who supplied what and when;
- show the supplier exactly what is still missing.

### 3. Compliance Passport

Each supplier/product/plot evidence package becomes a reusable, permissioned record.

Purpose:

- stop requesting the same evidence repeatedly from the same supplier;
- reuse validated master data across future shipments where legally and factually applicable;
- allow a supplier to share an approved subset with another buyer through an explicit permission flow;
- preserve version history so old and new evidence are never silently mixed.

A passport is not a legal certification. It is a structured reusable evidence bundle.

### 4. Geodata Sanitiser

Before information reaches the EU system:

- validate coordinate format and CRS;
- detect malformed/empty/self-intersecting geometries;
- normalise permitted geodata into the required internal representation;
- detect obvious duplicates and impossible coordinates;
- preserve source files and transformation evidence;
- route uncertain cases to review rather than pretending they are valid.

Satellite/deforestation analysis is a separate capability and must only be advertised once a defensible data provider and methodology are integrated.

### 5. Due-Diligence Case Builder

For every relevant shipment/case XGuard assembles:

- product and quantity data;
- country/production details;
- supplier and customer chain information;
- plot/geolocation evidence;
- supporting documents;
- prior DDS references where relevant;
- risk-assessment inputs;
- mitigation evidence if required;
- an evidence-completeness status.

Missing items automatically become supplier/internal tasks instead of silent failures.

### 6. EU Submission Orchestrator

When EU production integration and the participant's credentials/authorisation are valid, XGuard should:

- map the internal case to the current EU schema;
- submit DDS/simplified declarations where the law and role require it;
- support grouping where the current EU specifications permit it;
- retrieve status/reference information;
- handle safe idempotent retry and reconciliation;
- distinguish accepted, rejected, pending and unknown states;
- never charge a success fee when XGuard did not produce the promised successful event.

### 7. Reference Exchange Network

After a valid reference exists:

- deliver it to the buyer/customer workflow;
- associate it with shipment/PO/product records;
- provide a structured supplier-to-buyer handoff;
- permit ERP/customs integrations to retrieve the reference automatically;
- maintain a timestamped evidence receipt.

This is the distribution loop: buyers invite suppliers; suppliers experience XGuard because their buyer requires the operational handoff; suppliers can then use XGuard with their own supply chain.

### 8. Customs / ERP Handoff

XGuard should integrate without forcing the customer to replace its ERP:

- inbound webhook/API/CSV/email ingestion where safe;
- outbound webhook/API of case state and DDS reference;
- mapping to shipment/PO/invoice identifiers;
- partner white-label mode;
- status notifications and exception queues.

XGuard should be the invisible execution layer behind existing software whenever that is easier to adopt than a new dashboard.

### 9. Five-Year Audit Vault

XGuard stores the operational evidence package and version history needed by the company:

- input evidence;
- transformations;
- risk/decision records;
- submission payload hash and response state;
- reference handoff records;
- user/automation audit events;
- due-diligence-system change log.

Retention implementation must respect the customer's legal requirements, data-protection obligations and contractual policy.

### 10. Annual Review Pack

Because operators must review their due-diligence system at least annually, XGuard should generate a review pack:

- missing procedures;
- stale suppliers/evidence;
- failed/exception cases;
- unresolved mitigation items;
- changes in workflows/roles;
- exportable record of review actions and updates.

This creates recurring value even when filing volume is temporarily low.

## The zero-repeat-work rule

Every product decision must pass this test:

> Does this feature prevent the customer from entering, requesting, validating, reconciling or filing the same information twice?

If no, it is not core.

## Commercial model

### Free adoption wedge

- Readiness assessment.
- Supplier/reference Inbox.
- Basic supplier intake.
- Basic evidence receipt.

### Paid execution

Charge only for value-producing operational events, for example:

- completed enhanced evidence validation;
- completed geodata processing package;
- successful EU submission/reconciliation once production integration is available;
- managed exception resolution tiers;
- enterprise automation/white-label API.

Partner revenue share may be offered to ERP/customs/software partners on paid downstream activity. Partner incentives must be transparent and contractual.

## $400/day target

USD 400/day is a commercial target, never a guarantee.

Illustrative gross revenue before partner share, taxes and variable costs:

- $5/event -> 80 paid events/day;
- $4/event -> 100/day;
- $3/event -> 134/day;
- $2/event -> 200/day.

Therefore distribution should prioritise partners with recurring transaction flow rather than one-off small customers.

## Positioning

Bad positioning:

- "another EUDR platform"
- "upload documents and see a dashboard"
- "we make you compliant"

Preferred positioning:

> **XGuard runs the EUDR back office for you. Prepare once. Reuse evidence safely. Let suppliers fill their own gaps. Submit through one execution layer. Keep every case audit-ready.**

## Product boundary

XGuard must not:

- state that XGuard itself is legally mandatory;
- claim EU affiliation/approval without evidence;
- present an internal readiness score as legal compliance;
- call a DDS verified unless an authoritative verification action succeeded;
- promise that software eliminates the operator's legal responsibility;
- invent satellite or legality verification results;
- silently reuse stale supplier/plot evidence across shipments.
