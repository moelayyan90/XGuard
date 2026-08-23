# XGuard Child Safety — Regulatory Readiness Roadmap

Status date: 2026-08-20

## Objective

Position XGuard as privacy-preserving child-safety compliance infrastructure that can be evaluated, piloted, procured, certified where applicable, and potentially listed by competent schemes. The objective is **not** to ask a legislature to mandate the XGuard brand. Laws and procurement specifications should remain technology-neutral; XGuard should compete to become an accepted implementation of the required controls.

## Current product boundary

XGuard evaluates safety events deliberately submitted by an integrated service and returns proportionate safety decisions. It must not become mass surveillance, a hidden government feed, parental spyware, continuous device monitoring, location tracking, advertising profiling, or a child social-scoring system.

For age assurance, XGuard should receive the minimum necessary result from a verifier/provider or host. Preferred evidence is an anonymous age-threshold result (for example, `18+`) rather than date of birth, exact age, identity document, full name, address, or a reusable identity credential.

## European Union

### Target

The European Commission's EU Age Verification Solution and future EU Age Verification Scheme are the primary near-term interoperability targets.

The Commission's current public direction includes:

- anonymous proof-of-age technology;
- privacy-preserving verification that does not disclose exact age or identity to the online service;
- compatibility with the European Digital Identity Wallet architecture;
- OpenID4VP 1.0 / DCQL in the current reference implementation;
- third-party scrutiny for cybersecurity and privacy;
- a future list of trusted proof-of-age providers and trusted age-verification solutions;
- Member State rollout efforts through the end of 2026.

### XGuard implementation target

1. Integrate with a compatible verifier/RP rather than invent a proprietary identity protocol.
2. Accept a one-time, minimum-data threshold result and bind it to the safety-policy decision.
3. Never persist raw DOB, passport images, full identity data, or a reusable wallet presentation in the child-safety ledger.
4. Preserve evidence of provider/verifier identity, method, threshold, result, issue/expiry time, policy version, and control outcome.
5. Keep trusted-list and certification claims externally verifiable; never infer them from a caller-supplied string.
6. Prepare for independent security/privacy scrutiny and scheme-specific conformity assessment when the final participation process is available.

### Do not claim yet

- EU trusted proof-of-age provider
- EU trusted age-verification solution
- EU-approved / Commission-approved
- DSA certified

Those statements require a formal, externally verifiable grant or listing.

## United Kingdom

### Target

Ofcom's highly effective age assurance (HEAA) criteria under the Online Safety Act:

1. technical accuracy;
2. robustness;
3. reliability;
4. fairness.

Accessibility, interoperability, privacy and data-protection obligations also matter. Outsourcing age assurance to a vendor does not transfer the regulated service's legal responsibility.

### Evidence XGuard should require or preserve

- evaluation methodology and metrics for technical accuracy;
- circumvention / attack testing and mitigations;
- operational uptime, failure and fallback evidence;
- ongoing monitoring and change control;
- fairness testing across relevant user groups;
- accessibility and alternative-path evidence;
- provider due diligence;
- privacy / data minimisation assessment;
- issue and expiry time of age evidence;
- host enforcement and human-review records.

A green `ukHeaaEvidenceComplete` field only means the four evidence flags were supplied and the age result was represented as verified by the provider/host. It is **not** an Ofcom approval or legal conclusion.

## ISO/IEC 27566-1:2025

Use the published age-assurance framework as an architecture/governance mapping target. XGuard readiness metadata should make audits easier, but no code path may describe XGuard as ISO-certified until an applicable independent certification process has been successfully completed.

## Regulatory evidence chain

The target chain is:

`Age / eligibility evidence -> Safety risk decision -> Proportionate host enforcement -> Human review where required -> Machine-readable evidence -> Regulator / auditor export`

The evidence envelope should contain only what is necessary to demonstrate the control, not a second identity database.

## External work required before government or trusted-list claims

These items cannot be completed by source-code changes alone:

- independent security assessment / penetration testing;
- empirical accuracy, robustness, reliability and fairness testing of the actual age-assurance method;
- privacy impact assessment and child-rights impact assessment;
- vendor / issuer trust and certificate-chain due diligence;
- jurisdiction-specific legal review;
- applicable conformity assessment or certification;
- formal scheme / trusted-list application;
- procurement eligibility, contracting and insurance requirements where requested;
- regulator or public-authority review of pilot evidence.

## Public machine-readable surfaces

- `GET /v1/child-safety/principles`
- `GET /v1/child-safety/compliance-profile`
- `GET /v1/child-safety/age-assurance/schema`
- `POST /v1/child-safety/age-assurance/evaluate`
- `GET /v1/child-safety/regulator-pack`

## Public review pages

- `/child-safety/age-assurance`
- `/child-safety/regulatory-readiness`
- `/child-safety/compliance`
- `/child-safety/governments`
- `/child-safety/rights`

## Primary official references

- European Commission, EU approach to age verification: https://digital-strategy.ec.europa.eu/en/policies/eu-age-verification
- European Commission, Age Verification Solution FAQ: https://digital-strategy.ec.europa.eu/en/faqs/eu-age-verification-solution
- European Commission / EUDI, technical specification: https://github.com/eu-digital-identity-wallet/av-doc-technical-specification
- EUDI verifier endpoint reference implementation: https://github.com/eu-digital-identity-wallet/eudi-srv-verifier-endpoint
- Ofcom, age assurance duties: https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/age-assurance
- ISO/IEC 27566-1:2025: https://www.iso.org/standard/88143.html
