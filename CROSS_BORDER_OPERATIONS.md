# XGuard Smart Cross-Border Operations

## Product definition

XGuard is designed to act like an external operations employee for companies that repeatedly deal with government, customs, compliance, suppliers and cross-border administration.

It is not positioned as a legal oracle or a generic chatbot. Its job is to take a supported operational objective and turn it into a durable, deadline-aware case with visible progress, evidence and exceptions.

## The employee model

A company should be able to hand XGuard one of these inputs:

- shipment or purchase-order event;
- government request or notice;
- customs request or required reference;
- compliance task;
- supplier evidence request;
- renewal or deadline-driven administrative task.

XGuard should then perform the repeatable work:

1. identify the configured jurisdiction, authority and workflow;
2. create the case and deadline;
3. reuse current authorised master data;
4. identify missing facts and evidence;
5. request, remind and escalate;
6. prepare forms, references and the evidence package;
7. validate completeness and obvious inconsistencies;
8. route the case to `READY` or a specific `EXCEPTION`;
9. use an authorised execution/filing/handoff route where that capability has actually been configured and validated;
10. reconcile acknowledgement, status or reference;
11. return the result to the customer's system or team;
12. preserve an audit record.

## Why the machine matters

The product is intentionally aimed at work where fatigue and memory create avoidable operational risk.

Automation can provide:

- repeatable checks;
- deadline visibility;
- parallel handling of many cases;
- consistent data mapping;
- deterministic duplicate protection;
- durable audit events;
- persistent exception queues.

It cannot remove the legal responsibility of the operator, declarant, importer, exporter or other legally responsible party. Legal judgment and declarations that require a responsible person remain with that party.

## Multilingual operating model

XGuard should preserve both the original material and the normalised operational representation.

For every supported language workflow:

- retain the source text/document reference;
- store the detected/declared source language;
- store the customer's preferred working language;
- translate or normalise only through an approved workflow;
- preserve regulatory terms and field identifiers;
- flag uncertain translations instead of presenting them as authoritative;
- keep a translation/normalisation event in the audit record.

"All languages" is a product direction, not a current blanket capability claim. A language is supported only after the workflow can handle it reliably enough for the specific task.

## Jurisdiction onboarding gate

A country/authority workflow is not considered executable until all applicable items are known and validated:

- authoritative legal/procedural source;
- responsible role and required authority;
- current form/schema or portal/API;
- required fields/documents;
- language/format constraints;
- authentication/signature requirements;
- fees and third-party charges;
- deadline/renewal semantics;
- acknowledgement/reference semantics;
- retry/idempotency rules;
- human-decision boundaries;
- test/conformance path where available.

Until then, XGuard may accept and organise the task, but it must not pretend that filing or government execution is automated.

## First focused workflow

EUDR is the first focused commercial workflow because it combines supplier data, geolocation, due-diligence preparation, references, cross-company handoffs and audit retention.

The EUDR workflow is documented separately in [EUDR_OPERATIONS_ENGINE.md](EUDR_OPERATIONS_ENGINE.md).

## Commercial model

The preferred model is event-based rather than seat-based.

Current launch prices:

- readiness and basic EUDR supplier/reference Inbox: **€0**;
- completed EUDR operational case: **€9**;
- recurring volume/embedded EUDR case: **€4–€6**.

Future government/customs task prices must be published only after the relevant workflow is actually executable and its third-party costs are understood.

## Non-negotiable truth rules

XGuard must never:

- represent itself as a government or customs authority;
- claim an official approval that does not exist;
- claim a legal requirement forces companies to use XGuard;
- fabricate an official reference, status or filing result;
- submit without required authority or credentials;
- translate uncertainty into false certainty;
- call a workflow globally supported merely because a generic task record can be created.
