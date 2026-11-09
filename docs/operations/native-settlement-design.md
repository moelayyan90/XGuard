# Native settlement: implemented simulation, production disabled

## Current state

The isolated engine is implemented and tested with real EIP-712 signatures from newly generated, unfunded in-memory accounts and a simulated chain. SQLite stores actual replay, idempotency, transaction-nonce and state-machine records. **No local EVM contract was deployed, no real RPC broadcast was performed, no asset moved and no production signer was created.** Mock receipts are not on-chain evidence. The module has no production Worker route, binding, key import or broadcast transport. Public /supported continues to expose the existing upstream compatibility kind and empty local signers. Discovery only reports the truthful disabled status.

The original upstream /verify and /settle remain intact. This engine never calls a facilitator or switches to one after a native attempt. A future explicit rail selection must bind the quote, idempotency domain, signer policy and authorization to one path. An unknown native broadcast must reconcile before any other attempt.

## Protocol scope and official sources

* [x402 exact EVM specification](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md): EIP-3009 verification, transferWithAuthorization and pending-settlement semantics. Uses installed @x402/core and @x402/evm 2.24.0, including the official ExactEvmScheme verifier and ABI.
* [Circle USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses): Base Mainnet USDC is 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913. EIP-712 domain is pinned to USD Coin / 2, chainId 8453.
* [Base network fees](https://docs.base.org/specifications/transactions/network-fees): settlement needs funded ETH gas and covers both L2 execution and L1 data fees. Fixture fee caps are not a production fee quotation or complete L1 cost bound.

Initial scope is x402 v2 exact, EOA EIP-3009, Base native USDC. Permit2, smart wallets, ERC-6492 deployment, alternative assets and gas-sponsoring extensions are deliberately unsupported. Native scope does not replace or narrow the existing compatibility rail.

## Component map

| Component | Implementation and boundary |
| --- | --- |
| Native Payment Verifier | policy.js and NativePaymentVerifier: strict accepted/requirements agreement, pinned chain/asset/domain, recipient, exact amount, validity, signature, authorizationState, bytecode and official SDK simulation. Fresh state required for admission. Invalid signatures cannot reserve a replay lock. |
| Transaction Builder | buildSettlementTransaction: exact transferWithAuthorization calldata, zero native value, pinned Base USDC target. |
| Secure Signing Adapter | SecureSimulationSigningAdapter: simulation-only; independent calldata and EIP-712 re-verification, signer is never the payer, explicit gas/fee caps, no key loading or network sending. |
| Replay Protection | Authorization key binds chain, asset, payer and nonce, independently of signature byte representation and client idempotency key. No automatic expiry deletes safety state. |
| Idempotency Engine | SqliteSettlementRepository atomically compares the signed authorization/request contract and idempotency index. Changed input conflicts, changed keys replay-reject, exact completed retries return the original receipt. |
| Transaction State Machine | RESERVED → PREPARING → PREPARED → SUBMITTING → BROADCAST → CONFIRMING → CONFIRMED, with UNKNOWN, REVERTED, REJECTED and QUARANTINED outcomes. Durable ownership leases fence racing workers; signer nonces are reserved in the same transaction as unsigned intent. |
| Confirmation Tracker | ConfirmationTracker verifies transaction hash, status, canonical receipt block, target, matching USDC Transfer event, minimum 2 observed confirmations and consumed authorization nonce. Broadcast acceptance is never success. |
| Receipt Generator | settlementReceipt includes hash, block evidence, payer, beneficiary, amount, confirmations and confirmation time. All lab receipts are explicitly native-simulation with financial_value_moved=false. |
| Reconciliation Engine | reconcileOwned only follows the already persisted hash and bytes. Lost broadcasts, receipt RPC errors and delayed confirmations remain pending with bounded backoff, at most 10 automatic checks and no replacement charge. Recovery works after authorization expiry and process restart. |
| Audit & Observability | Immutable native_audit transitions plus sanitized timing events. No private key, raw signed transaction, authorization signature or RPC credential is logged. State and signed bytes remain private in the isolated repository. |

## Crash and race boundaries

Durably reserve the signer nonce and unsigned intent before signing; durably persist the raw signed transaction and deterministic hash before broadcast; mark SUBMITTING before the external call. A process failure can therefore reconcile the same hash, or safely resume the same already recorded transaction. No financial obligation is represented by an eventually consistent cache. Public analytics infrastructure is not used for native accounting.

Twenty-four concurrent attempts for one payment produce one simulated broadcast. Separate payments reserve separate persisted signer nonces. Invalid signatures, changed input and alternate idempotency keys cannot poison or bypass the authorization lock. If durable state fails, the engine does not release replay protection or claim success.

## Key-management evaluation and activation gates

[AWS KMS asymmetric keys](https://docs.aws.amazon.com/kms/latest/developerguide/symmetric-asymmetric.html) and [supported key specs](https://docs.aws.amazon.com/botocore/latest/reference/services/kms/client/create_key.html) support ECC_SECG_P256K1 signing without exporting the unencrypted private key. A production adapter would need Ethereum digest signing, DER-to-r/s handling, low-s normalization, recovery-id validation and independent transaction policy. No KMS resource was provisioned and no cost was incurred.

An isolated private Worker with a secret-held key could be evaluated under the existing plan, but it is not an HSM and exposes key material to that process. Neither alternative is configured. Any production adapter must be a separate private service with no public signing endpoint; its identity receives only the narrow signing permission for one key, with explicit beneficiary/asset/calldata/chain restrictions, gas and daily spending limits, audit, emergency revocation and a planned key-rotation process. The public API must have no raw key or general-purpose signing capability.

Before production, the owner must explicitly approve the signer method, a fixed gas-funding amount and spending cap, production key creation/use, and one specifically bounded real settlement. Additional technical gates: independent security review; total Base fee estimation including L1 data fees; trustworthy RPC/chain-state verification; real local-EVM/testnet integration; nonce-gap recovery; finality policy; external signer availability and failover; receipt/reorg reconciliation after initial confirmation; protected operator reconciliation for the bounded-check/manual-review state; actual load/capacity measurements. No production-ready claim is made by the 29 simulation tests.

## Jordan legal gate

The Jordan Securities Commission publishes [Law No. 14 of 2025](https://jsc.gov.jo/page.aspx?page_key=%D9%82%D8%A7%D9%86%D9%88%D9%86_%D8%AA%D9%86%D8%B8%D9%8A%D9%85_%D8%A7%D9%84%D8%AA%D8%B9%D8%A7%D9%85%D9%84_%D8%A8%D8%A7%D9%84%D8%A3%D8%B5%D9%88%D9%84_%D8%A7%D9%84%D8%A7%D9%81%D8%AA%D8%B1%D8%A7%D8%B6%D9%8A%D8%A9) and [the 2025 VASP licensing regulation](https://www.jsc.gov.jo/News/en/12582). The law lists transfers between virtual-asset addresses among covered activities and imposes licensing/legal-person requirements for relevant services for others. Whether this particular non-custodial software/facilitator operation is within scope requires qualified local legal/regulatory determination. Non-custody is not treated as an automatic exemption. No licensing determination, contractual commitment or approval was obtained, and no live financial activity was introduced.

## Agent402 acceptance

Their latest 2026-11-09 response confirms discovery and identity but rejects another relay to existing upstream facilitators. They will reconsider a signer XGuard controls on a network they accept. This simulation does not remove that blocker. Do not add a local signer to metadata or contact them claiming independence. After explicit financial approval and the prerequisites above, the concrete evidence required is an actual successful Base settlement, verifiable transaction/receipt, the deployed signer identity, rejection/latency comparison and agreed canary scope. Their seller price/payTo/routing must remain unchanged unless they explicitly agree otherwise.
