# Owner payouts

`AUTO_OWNER_PAYOUT=true` expresses the desired policy, not permission to move funds. The default minimum is `$100`, checked daily. The implementation evaluates distributable funds and fails closed; the external transfer connector is deliberately inactive until a regulated provider is eligible and authorized.

## Safety gate

No payout is prepared or submitted unless the destination is verified, KYC is complete, the provider is authorized and operational, available balance is certain, funds are final, reconciliation is consistent, no earlier payout is ambiguous, all operating liabilities are paid, and the operating reserve is fully funded. Destination amount plus provider fee is reserved atomically; the policy, reserve, and safety snapshots are bound to the XGuard idempotency key. Final credit or return requires typed evidence matching the provider, provider reference, destination amount, and fee. Idempotency is required at XGuard and provider layers.

## Current regulated off-ramp research

Research was retrieved 2026-08-14 from official Circle documentation:

- Circle describes [Circle Mint](https://developers.circle.com/circle-mint) as an institutional product and requires an approved account/API key; a sandbox signup does not establish production eligibility.
- The current [supported-country list](https://developers.circle.com/circle-mint/references/supported-countries) includes Jordan for bank accounts domiciled there, but the page says the list can change and it does **not** establish that XGuard, its owner, or a particular bank destination is eligible.
- The [fiat withdrawal guide](https://developers.circle.com/circle-mint/howtos/withdraw-fiat) documents USDC/EURC redemption to a linked bank account, an idempotency key, balance checks that distinguish available from unsettled funds, asynchronous `pending`/`complete`/`failed` status, and the possibility of a bank return after `complete`.
- [Supported payment rails](https://developers.circle.com/circle-mint/references/supported-payment-rails) document international SWIFT for USD/EUR and state that limits can depend on banking-partner configuration.
- Circle Mint uses v1 SNS delivery according to the current [webhook overview](https://developers.circle.com/api-reference/webhooks); notifications are at least once, may be out of order, and must be signature-verified and deduplicated before affecting financial state. The [Mint notification reference](https://developers.circle.com/circle-mint/references/webhook-notifications) includes payout status, fees, and errors.
- [CAMT.053 statements](https://developers.circle.com/circle-mint/references/camt053-statements) may support independent daily statement reconciliation for an approved account.

No official page reviewed guarantees account eligibility, a payout to a particular bank/account, a fixed public fee, or a universal minimum. Those values must come from the approved business account and current contract/API before activation. Circle is therefore only a researched candidate, not the selected or active provider. Other regulated providers can be evaluated under the same controls; none is assumed eligible.

## Current status

`OWNER PAYOUT: EXTERNAL_BLOCKER`. No destination details are stored in this repository. The policy engine and atomic payout ledger are tested, but no connector can submit a transfer. XGuard can run testnet, routing, diagnostics, and accounting without an off-ramp; mainnet and automated payout remain disabled.
