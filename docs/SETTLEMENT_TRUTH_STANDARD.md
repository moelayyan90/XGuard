# Settlement Truth Standard (STS) — Proposal

Status: Draft / vendor-neutral proposal
Reference implementation: XGuard

## Purpose

Payment systems can prove that a payment was requested and may report that it was submitted, but infrastructure still needs a portable way to answer a stricter operational question after the submit boundary:

> What is the independently established truth of this logical payment, and is it safe to treat it as final without risking a duplicate submission?

STS defines a transport-neutral settlement-truth contract that can be embedded by payment rails, facilitators, gateways, wallets, processors, or orchestration layers. It does not change the buyer-authorized payment amount, recipient, or payment scheme.

XGuard is the first reference implementation. The standard itself is intentionally vendor-neutral so payment platforms can adopt it without becoming locked to one provider.

## Core invariant

For one immutable logical payment identity, an STS implementation MUST expose exactly one current truth state:

- `FINALIZED` — independent evidence proves the intended settlement finalized.
- `PENDING` — submission may have occurred or finality is not yet sufficient; automatic duplicate submission is unsafe.
- `PROVEN_FAILED` — independent evidence proves the intended settlement did not finalize and the failure is safe to act on under the rail's retry policy.
- `CONFLICT` — evidence conflicts with the declared payment intent or multiple incompatible outcomes exist.

An implementation MUST NOT convert an uncertain post-submit state into `PROVEN_FAILED` merely because a downstream request timed out.

## Logical payment identity

The identity MUST be derived from immutable, payment-authorizing material rather than an application retry identifier alone.

The normalized identity SHOULD bind, where available:

- payment scheme and protocol version;
- network / rail identifier;
- payer or funding principal;
- intended recipient;
- asset and amount or permitted amount envelope;
- authorization nonce / sequence / transaction intent identifier;
- authorization validity window;
- resource or commercial context when the underlying protocol binds it.

Implementations MUST reject an attempt to reuse the same logical identity with conflicting payment intent.

## Submit-boundary rule

STS separates pre-submit validation from post-submit truth.

Before an outbound value-moving submission begins, the rail may reject safely and choose another route according to its policy.

After the submit boundary begins, the rail MUST NOT blindly create a second value-moving submission for the same logical payment while STS state is `PENDING` or `CONFLICT`.

## Evidence

A truth decision SHOULD retain sufficient evidence for independent audit and reconciliation, including where applicable:

- rail / facilitator identity;
- network;
- transaction or transfer identifier;
- block / ledger position;
- asset;
- payer;
- recipient;
- settled amount;
- confirmation / finality depth or equivalent;
- evidence source(s);
- first observed and resolved timestamps.

Evidence storage SHOULD minimize sensitive application metadata and MUST NOT require raw private credentials or private payment payloads to be exposed publicly.

## Idempotency

The same logical payment MUST produce at most one final `FINALIZED` accounting event in a compliant STS ledger.

Repeated observations, webhook retries, client retries, or repeated reconciliation runs MUST be idempotent.

Corrections SHOULD use append-only compensating events rather than destructive rewriting of historical financial evidence.

## Rail integration contract

A rail-integrated implementation SHOULD provide equivalent internal operations:

```text
identifyRailPrincipal()
prepare(paymentIntent)
markSubmissionBoundary(evidence)
resolve(logicalPaymentIdentity)
getTruth(logicalPaymentIdentity)
exportEvidence(range/filter)
```

A commercial implementation MAY also expose finality-gated usage accounting, but pricing is outside the STS wire standard.

## x402 mapping

For x402 v2, an implementation can map STS into the protocol's extension model under a proposed extension identifier:

```text
settlement-truth
```

A facilitator advertising native support would include `settlement-truth` in its supported extension identifiers.

A settlement response MAY carry a compact truth artifact in `extensions["settlement-truth"]`, for example:

```json
{
  "version": 1,
  "logicalPaymentId": "sha256:...",
  "state": "FINALIZED",
  "resolvedAt": 1787030000,
  "evidence": {
    "network": "eip155:8453",
    "transaction": "0x..."
  }
}
```

The artifact does not authorize value movement and MUST NOT rewrite the x402 buyer-signed payment contract.

## XGuard Safe Settlement Profile

The XGuard Safe Settlement Profile is an adoption profile built on STS. It is not part of the vendor-neutral STS core.

A rail claiming conformance to `xguard-safe-settlement/1` MUST:

1. implement the four STS truth states;
2. bind truth to immutable logical payment identity;
3. establish a durable submit boundary;
4. forbid blind duplicate submission while truth is uncertain;
5. use an independent or independently queryable finality source before reporting `FINALIZED`;
6. expose idempotent reconciliation evidence;
7. preserve the original buyer-authorized recipient and amount;
8. fail closed on conflicting settlement evidence.

XGuard MAY certify a rail or integration against this profile only after test evidence demonstrates the required invariants. Certification must not be implied merely because an integration endpoint exists.

## Cross-rail adapters

STS is intentionally not limited to x402. Adapters may map equivalent payment identities and evidence from other rails, including card processors, stablecoin processors, bank-payment orchestration, wallets, and proprietary gateways, provided the adapter can identify a durable submit boundary and independently resolve settlement truth.

A rail-specific adapter MUST document which STS guarantees it can and cannot prove. If a rail does not expose enough evidence for a guarantee, the adapter MUST report that limitation rather than fabricate finality.

## Adoption strategy

The standard should be distributed through:

1. open-source facilitator reference implementations;
2. x402 extension proposals and facilitator capability declarations;
3. payment-orchestration and agent-payment platforms;
4. infrastructure marketplaces and integration catalogs;
5. conformance tests that make STS support machine-verifiable;
6. production incident evidence showing the cost of ambiguous or duplicate settlement handling.

The long-term goal is for payment infrastructure to treat settlement-truth support the way production systems treat idempotency, reconciliation, and durable transaction evidence: not as a cosmetic feature, but as a baseline reliability capability.

## Non-goals

STS does not:

- become a custodian;
- redirect merchant funds;
- modify buyer signatures;
- silently deduct a proprietary fee from a signed payment;
- claim legal or regulatory certification by itself;
- guarantee exactly-once execution across arbitrary distributed systems.

It defines a portable truth and safety boundary around payment settlement.