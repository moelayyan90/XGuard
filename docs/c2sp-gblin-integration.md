# GBLIN cross-witnessing

XGuard accepts C2SP `add-checkpoint` requests for the fixed
`gblin.digital/receipts-log` origin and its published Ed25519 log key.
The production witness name is `xguardgate.com/witness`; obtain its actual
type-0x04 verifier key from `https://api.xguardgate.com/witness/verifier-key`.
Private key material is generated and retained inside the isolated
`C2SP_WITNESS` Durable Object. It is never an environment variable, repository
secret, HTTP response or workflow artifact.

Submission prefix: `https://api.xguardgate.com/witness`.
Monitoring prefix: the same URL. The monitoring path is
`/<lowercase-hex-SHA256-of-origin>/checkpoint` and returns both the verified
GBLIN log signature and XGuard's timestamped Ed25519 cosignature.

The runtime was staged in PR #596, followed by the config-only lifecycle
migration in PR #597. Subsequent runtime fixes retain the same namespace,
object name and storage keys. Never remove or recreate the namespace to repair
a deployment: it contains the durable identity and trusted latest checkpoint.

The Go-reference requests from GBLIN exercise 40 sequential cases and 5
concurrent growth requests. The real workerd test verifies exactly one winning
update, unchanged production trust pins, a stable cold-start key, and key/head
survival across SQLite runtime restarts. Node/OpenSSL independently verifies
the emitted cosignatures, including checkpoint extensions.

After successful production deployments, the C2SP verification workflow fetches
a genuine signed GBLIN checkpoint, verifies its pinned log signature and any
required consistency proof, submits it, and verifies the persisted monitored
cosignature. It records only public protocol evidence. It sends no payments,
uses no operator credentials and never submits test-origin checkpoints to the
production witness. A successful validation-runner submission is evidence that
GBLIN → XGuard cosigning works; it is not evidence that GBLIN has configured
its own automatic push. Confirm that separately in issue #211 or GBLIN's public
`/log/witnesses` status.

## ProofRail reverse direction

The existing ProofRail compatibility code implements ES256-signed execution evidence, using
`ProofAuthority` and the proof helpers in `paid-agent-entry.js`. The discovery
record in `canonical-entry.js` describes this scope. It does not implement a
C2SP append-only Merkle log, an Ed25519 checkpoint signer or consistency-proof
endpoint. The current public Live router returns 410 for the retired `/v1/proof`
and `/v1/ready` URLs. Active paid readiness is `/api/paid/v1/readiness`.
The GBLIN log origin is not an XGuard/ProofRail log origin.

A small future addition can publish hashes of already public, redacted proof
envelopes into a separate append-only log. It must not change payment state,
the execution response contract, ProofAuthority, settlement finality or replay
guards. Admission should be an idempotent post-success event using the immutable
proof digest, with no private execution inputs in leaves. The isolated log must
own its leaf sequence, RFC 6962 tree frontier and historical subtree hashes;
commit leaves and frontier atomically, then sign checkpoints with a distinct
Ed25519 log key. Publish `/proofrail/log/checkpoint`, `/consistency?old=&new=`,
`/leaves`, inclusion proofs and a type-0x01 verifier key only after complete
append-only and crash-recovery tests. Use a separate staged runtime/config-only
migration sequence and get GBLIN's non-binding test agreement before enabling
their witness. This is a scoped design, not an implemented reverse log.

## Payment comparison

Keep GBLIN's direct facilitator path as the control. Request a non-promised,
non-indexed route only after witnessing is working. Validate the live XGuard
`GET /supported`, `POST /verify`, `POST /settle` and x402 discovery contract
before sharing instructions. Preserve the route's `payTo`, asset, network,
amount, x402 challenge and idempotency/reconciliation behavior; do not redirect
the Bazaar-indexed or hash-pinned production routes. No financial commitment,
contract or revenue share is authorized by this technical evaluation.
