# Open Verifier profile 1.0

This profile defines the local decision made between an agent inspecting a price and an operator-controlled wallet signing a transfer. A consumer can implement the contract with the public vectors and its own merchant, wallet and storage.

## Offer and policy

The operator supplies policy version 1. Each resource is an exact, canonical HTTPS URL without credentials, query or fragment. Its entry pins one recipient and one EC P-256 public JWK with a DID key identifier. The policy also selects one EVM chain, one token contract and two positive token-unit limits. Amounts are canonical base-10 strings in the unsigned 256-bit range. Compare them as integers. The per-call cap cannot exceed the rolling cap.

Accept x402 version 2 with exactly one payment option and one compact ES256 JWS in the offer-receipt extension. Verify the raw 64-byte ECDSA signature over the original two base64url segments. Permit only alg, kid and optional typ in the protected header. Select the key from the local resource rule. The signed version-1 offer and wire option must agree on exact scheme, network, token, recipient and amount. Require a strictly future signed validUntil and an amount within the call cap.

For GET the body is empty. For POST the input body is the literal UTF-8 string to be sent, up to 65536 bytes. The request digest is lowercase SHA-256 over UTF-8 JSON.stringify([method, resourceUrl, body]). The offer digest covers the compact JWS string. The terms digest covers UTF-8 JSON.stringify of the accepted wire object, retaining its member order. Carry that object through the host without normalizing or reordering it. A different serialization can require fresh approval. Local request binding covers method, URL and body. The merchant offer signs its resource and payment terms. Keep headers and any additional application context under host control.

## Consent and signing

1. The operator chooses an operation ID and reviews the method, URL, body, payer, destination, atomic units and expiry. Persist explicit consent in a journal outside the agent's control.
2. The host compares the structured review returned through MCP with its own independently verified copy. It recomputes the request, offer and terms digests. The host selects the wallet from local configuration.
3. Inside a SQLite immediate transaction, recheck the offer using the current clock after acquiring the lock. Sum previously consumed amounts in the window (now minus 86400 seconds, now] for the chain and token. Reject reuse, changed bindings or a cap violation. Commit consumption before invoking the signer.
4. The adapter calls the wallet with EIP-712 TransferWithAuthorization. The payer, token name, token version and maximum validity come from the operator's signing policy. The chain and verifying contract come from the policy. The recipient and value come from the checked offer. The nonce is 32 random bytes. The validity ends at the earliest of the signed offer expiry, operator limit and merchant timeout. The signer returns a 65-byte EOA signature. Only the trusted host receives the payload and exact request. Its delivery process decides whether to submit them.

A signing policy requires a payer address, tokenName, tokenVersion and an integer maxValiditySeconds from 1 through 3600. The accepted option must declare a positive integer maxTimeoutSeconds and matching extra.name and extra.version. An absent extra.assetTransferMethod defaults to eip3009. The adapter rejects other transfer methods, additional option fields and unrecognized extra fields. Changing signing policy requires a fresh operation with explicit approval. A legacy approval made without a signing policy stays inspection/consumption-only.

A refusal, timeout, crash or invalid signature after consumption leaves the operation consumed. This design gives at most one handoff per approval and may produce no signature or payment. The token authorization binds the transfer fields. The journal and host bind the HTTP request. The EIP-3009 signature alone cannot prove which HTTP body was delivered.

## Receipts, rotation and recovery

The host obtains the expected payer and transaction hash from an independent record. Receipt verification checks the settlement success flag, EVM chain, resource, payer, transaction and inclusive issue-time window against the merchant's signed statement. Journal reconciliation additionally requires the original consumed operation, exact request and a receipt issued no earlier than consumption. With a signing policy the payer must also match the approved wallet. The same receipt can be reconciled repeatedly. A transaction can be linked to just one operation in the journal. This profile assumes one transfer per transaction. Auditing token movement, confirmation depth and delivered bytes requires separate chain and delivery evidence.

Rotate a merchant by obtaining its new public key through an independent channel, giving it a fresh kid, and replacing the resource's publicKey. A retired key may be retained for past receipts with retiredReceiptKeys entries of the form {"publicKey": ..., "lastIssuedAt": ...}. Offers always require the current key. Removing a retired key disables historical verification with that key. A compromised key can backdate an attestation. Revoke it and use independent records for affected transactions.

The model, its text and the merchant response are untrusted. The policy, host, signer, journal, local clock and operating-system isolation are trusted. Keep shell-capable agents away from these files and the wallet. A malicious local operator, clock rollback, journal replacement, or two hosts using separate journal copies can defeat a shared cap. Use one local writer domain per budget. Quiesce writers or use SQLite's backup API when making a consistent backup. After uncertain signing or storage loss, pause the wallet, reconcile its history and unresolved approvals with the merchant, and restore a complete journal before spending again. Replaying a stale backup can re-enable a consumed approval. Never issue a replacement approval merely because a response timed out.

## Portable conformance

[The JSON vectors](conformance/v1.json) carry public inputs and expected outcomes for two merchant keys. Use the supplied clock plus the case offset, select current or prior input and apply any set operation as a path/value pair. A cutoff offset changes the retired key's lastIssuedAt for that case. Compare the result status or failure identifier with want. The public keys, transactions and domains represent fixtures.

[The independent Python merchant](conformance/merchant.py) implements JWS generation using Python cryptography. Run it with --vectors for the deterministic suite, with no arguments for fresh artifacts, or with --serve 8765 to obtain a loopback HTTP 402 at /map. The signed logical resource is https://maps.example/map. The loopback service never settles payments. The separate Node merchant generates ephemeral keys and independent artifacts for the host tests.

## References

- [x402 signed offers and receipts](https://github.com/x402-foundation/x402/blob/main/specs/extensions/extension-offer-and-receipt.md)
- [x402 exact EVM scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md)
- [EIP-3009 transfer authorizations](https://eips.ethereum.org/EIPS/eip-3009)
