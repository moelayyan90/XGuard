# XGuard — Regulator / Government Evidence Packet

Status: pre-certification technical review packet

## One-sentence description

XGuard is privacy-preserving child-safety compliance infrastructure that accepts defined safety events from an integrated service, can bind minimum-data age-assurance evidence to the relevant policy path, returns proportionate protective decisions, and exposes machine-readable evidence for audit and regulator review.

## Claims boundary

XGuard does not claim government approval, regulator approval, EU trusted-list status, Ofcom approval, ISO certification, or legal compliance by virtue of this document or its APIs. Those statuses require the relevant independent process.

## Requested public-sector engagement

A government, regulator, Digital Services Coordinator, auditor or public child-safety body may use a bounded pilot to review:

1. the data-flow boundary;
2. the age-assurance interoperability boundary;
3. child-safety risk categories and intervention thresholds;
4. human-review requirements;
5. false-positive and false-negative measurement;
6. provider due diligence and trust evidence;
7. privacy / child-rights safeguards;
8. reporting and support routes;
9. retention and deletion controls;
10. machine-readable evidence exports.

## Explicit non-goals

- no mass interception;
- no background microphone/camera access;
- no child location tracking;
- no hidden parent or government feed;
- no advertising profile of children;
- no political, religious or behavioural policing;
- no general social scoring;
- no remote enforcement against services that have not integrated XGuard;
- no raw DOB or identity-document collection through the age-assurance evidence endpoint.

## Age-assurance evidence contract

The age-assurance adapter accepts a threshold result and operational evidence metadata. It rejects raw identity fields such as DOB, passport number, document image, full name and address.

The returned evidence distinguishes four separate facts:

- what the integrating service says the provider/verifier determined;
- what method and threshold were used;
- what evaluation evidence exists (accuracy, robustness, reliability, fairness, third-party scrutiny);
- what XGuard itself did and did not independently verify.

Caller-declared provider trust or certification is never converted into an XGuard approval claim.

## UK HEAA evidence view

The evidence envelope tracks:

- technical accuracy evaluated;
- robustness tested;
- reliability monitored;
- fairness evaluated.

`ukHeaaEvidenceComplete=true` is an evidence-completeness signal only. It does not mean Ofcom has approved XGuard or the integrating service.

## EU age-verification view

The evidence envelope can identify an EU blueprint-compatible integration target using OpenID4VP 1.0, privacy-preserving threshold results, third-party scrutiny and no identity / exact-age disclosure to XGuard.

`euBlueprintEvidenceComplete=true` is an internal evidence signal only. It does not mean XGuard has been placed on the EU Age Verification Scheme trusted lists.

## Audit questions XGuard must be able to answer

- Which policy version produced the protective decision?
- What age / eligibility evidence was available at the time?
- Was the evidence verified by the provider/host or merely unverified input?
- Did the age-assurance method have documented accuracy, robustness, reliability and fairness evaluation?
- Was an exact age or identity disclosed to XGuard?
- What safety category and confidence drove the intervention?
- Was human review required and completed?
- What action did the host platform take?
- What data was retained and for how long?
- Which external reporting/support route was applicable?
- What third-party security/privacy scrutiny existed at the time?

## Evidence still needed for a serious government submission

The repository can produce the technical packet, but the following must come from independent work or the relevant legal entity:

- legal-entity and contracting information;
- named data controller / processor roles and DPA terms;
- independent security report;
- production architecture threat model and penetration-test report;
- age-assurance performance report using the production method;
- fairness / accessibility report;
- DPIA and child-rights impact assessment;
- incident-response and breach-notification process;
- business continuity / disaster recovery evidence;
- applicable insurance and procurement declarations;
- certificates and trusted-list evidence where granted;
- regulator / scheme submission identifiers and decisions.

## Pilot acceptance criteria

A regulator-facing pilot should not be called successful merely because the API responds. Minimum evidence should include:

- pre-agreed harms and policy scope;
- representative test dataset and test protocol;
- measured false positives / false negatives where ground truth is available;
- latency and availability measurements;
- documented age-assurance bypass testing;
- human-review outcomes;
- privacy/data-flow verification;
- reporting-route validation;
- signed pilot report listing limitations and unresolved risks.
