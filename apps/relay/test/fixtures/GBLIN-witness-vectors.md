Request bodies and expected responses are copied from GBLIN's Go-reference
vectors (golang.org/x/mod/sumdb/note and sumdb/tlog), retrieved 2026-11-09:

https://github.com/gblinproject/gblin-treasury-risk-regime/tree/main/worker/test/witness-vectors

Upstream vectors.json Git blob: 7525c149127fef969856c291adc68beccff5e298.
Only the unused deterministic witness private/public key and netcfg fields are
omitted. All 40 sequential requests and 5 race requests remain unchanged.
The XGuard tests generate their own isolated witness key and independently
verify its C2SP type-0x04 cosignatures with Node/OpenSSL.

The test origin and trust key are supplied only to an isolated core instance.
The production C2SPWitness class always uses the fixed GBLIN trust policy.
