# Security Model

## Invariants

1. Non-enrolled programs are never delayed by XGuard.
2. Delay is bounded to 10–50ms.
3. A bypass requires an explicit marker on every top-level call to the enrolled program.
4. Indirect/CPI-style references are delayed conservatively.
5. Multi-application composition uses the maximum matching delay.
6. The critical-path decision is deterministic.
7. XGuard does not sign, mutate, simulate, or custody transactions or funds.

## Resource bounds

The reference engine rejects configurations with more than 4,096 application rules, more than 32 bypass markers per rule, or markers longer than 16 bytes. These are defensive implementation limits for review and testing; BAM may choose tighter production limits.

## Failure behavior

The policy engine itself has no external dependencies. A production BAM adapter should fail closed for an enrolled application only when the application has explicitly selected that behavior; otherwise the BAM node should retain an operator-defined fallback path so a plugin fault cannot disrupt unrelated transaction ingestion.

The public Cloudflare Worker is a static review surface and is isolated from scheduling infrastructure.

## Abuse considerations

### Registration spam

A permissionless registry needs economic or governance controls to prevent unbounded program registrations. XGuard does not create a private registration database as a workaround.

### Transaction spam

The delayed pool must have hard memory and queue limits. Admission accounting belongs in the BAM adapter where transaction size, CU budget, and scheduler pressure are visible.

### Marker ambiguity

Markers are exact byte matches at explicit offsets. There is no prefix guessing or heuristic classification. Application owners are responsible for choosing instruction markers that are stable for their program ABI.

### Composition bypass

When several rules match, the maximum delay wins. A composed transaction cannot reduce the delay by adding another enrolled program with a shorter speed bump.

## No AI in the critical path

XGuard deliberately does not use an LLM or probabilistic model to classify transactions. A scheduling guarantee is easier to audit when identical inputs always yield identical output.

## Reporting

Security contact: `mo.elayyan2023@gmail.com`.
