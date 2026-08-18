# Pricing

XGuard's canonical x402 mainnet service price is **$0.03 (30,000 micro-USD) per accepted authenticated economic attempt**, with no monthly subscription.

The runtime configuration is `XGUARD_FEE_MICRO_USD=30000`, where one USD equals 1,000,000 micro-USD. The public payment contract in `apps/worker/src/public-payment-contract.ts` is the source of truth for the corresponding USD amount, micro-USD amount, billing event, network, and Base USDC asset.

## x402 billable event

For the public x402 `/verify` and `/settle` execution path, the fixed attempt fee is earned when all of these conditions are true:

1. the request is authenticated for the required merchant scope;
2. the request is parseable as a supported economic x402 request;
3. XGuard can derive the canonical `logicalPaymentKey`; and
4. the merchant's prepaid XGuard service balance can cover the fixed attempt fee.

The fee is earned **before downstream execution**. A downstream verification or settlement failure does not refund an already accepted attempt.

The same `logicalPaymentKey` is idempotent: verify → settle and retries do not earn the fixed attempt fee a second time.

No x402 attempt fee is earned for malformed or unsupported input that is rejected before acceptance, unauthenticated traffic, or an idempotent retry that has already earned the fee for the same logical payment key.

## Other billable operations

XGuard also has separately configured execution classes for source discovery, model/tool execution, analysis, security inspection, and payment-decision services. Those fees are independent from the fixed x402 attempt fee and follow their own accounting policy.

Machine-readable discovery metadata such as health, readiness, `/supported`, and well-known manifests remains free. Value-producing discovery operations such as `/discovery/search` and `/discovery/resources` are not the same as free discovery metadata and may be billed under the SOURCE fee schedule.

## Separate costs

The **$0.03** XGuard attempt fee is not necessarily the buyer's or merchant's total transaction cost. Facilitator charges, network gas, token conversion, funding, and off-ramp fees are separate unless explicitly stated otherwise.

Changing the canonical fee affects future accepted attempts only. Historical ledger and usage records remain immutable; corrections use compensating entries rather than destructive edits.
