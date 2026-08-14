# Pricing

XGuard's default service fee is **$0.002 per successful billable settlement**. There is no monthly subscription. The exact configured value is `XGUARD_FEE_MICRO_USD=2000`, where one USD equals 1,000,000 micro-USD.

## Billable event

A fee is earned only when all of these conditions are true:

1. the payment is on an enabled mainnet;
2. XGuard has a unique immutable authorization identity;
3. one downstream facilitator returns a valid, successful settlement result;
4. independent chain evidence proves the expected transaction final on the requested network and binds payer, recipient, asset, and amount;
5. no existing usage event exists for that logical payment; and
6. the merchant's reserved XGuard service balance is captured transactionally.

No fee is earned for malformed input, invalid verification, a decline, definitive settlement failure, an ambiguous result, duplicate retry, health check, compatibility check, internal error, or testnet traffic. Ambiguous payments retain a hold but create no revenue; reconciliation later either captures after proven settlement or releases after proven failure.

## Separate costs

`$0.002` is the XGuard service fee, not necessarily the buyer's or merchant's total cost. Facilitator charges, network gas, token conversion, funding, and off-ramp fees must be disclosed separately. XGuard's route engine excludes normal routes with unknown variable cost or negative configured contribution margin.

Changing the fee affects future settlements only. Historical usage events retain their fee and policy version; corrections use compensating ledger entries rather than edits.
