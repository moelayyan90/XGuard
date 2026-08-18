# Treasury

XGuard treats merchant prepaid funds as customer service liabilities until a billable XGuard service event is earned. Gross revenue is never called profit.

| Measure                                            | Meaning                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `CUSTOMER_BALANCES` / `MERCHANT_PREPAID_LIABILITY` | prepaid service value XGuard still owes merchants                                         |
| `EARNED_REVENUE` / `XGUARD_SERVICE_REVENUE`        | XGuard service fees already earned under the applicable billing event                     |
| `OPERATING_EXPENSE`                                | facilitator, compute, database, network, monitoring, off-ramp and other attributable cost |
| `FACILITATOR_PAYABLE`                              | incurred but unpaid downstream liability                                                  |
| `OPERATING_RESERVE`                                | earned funds retained for continuity                                                      |
| `OWNER_DISTRIBUTABLE`                              | final funds remaining after liabilities, costs, pending payouts and reserve               |
| `PAID_TO_OWNER` / `OWNER_DISTRIBUTIONS`            | distributions proven paid                                                                 |

## Canonical x402 revenue event

For the protected public x402 `/verify` and `/settle` path, the canonical fixed fee is **$0.03 / 30,000 micro-USD once per accepted authenticated economic attempt**.

That service fee becomes earned after XGuard has:

1. authenticated the required merchant scope;
2. parsed/normalized a supported economic x402 request;
3. derived the canonical `logicalPaymentKey`; and
4. successfully reserved the fixed fee from the merchant's prepaid XGuard service balance.

The fee is earned before downstream execution. A downstream verification or settlement failure does not refund an already accepted attempt. The same `logicalPaymentKey` is idempotent, so verify → settle and retries add no second fixed attempt fee.

Independent Base finality determines **settlement truth** for the expected USDC transfer. It is not the trigger that turns the canonical accepted-attempt service fee into revenue.

Other gateway execution classes (model, tool, source, analysis, security and payment-decision operations) follow their own configured billing events and must not be collapsed into the fixed x402 attempt model.

## Ledger treatment

A merchant top-up posts treasury asset against merchant prepaid liability; the deposit itself is not revenue. When an applicable XGuard service event is earned, accounting reduces the corresponding prepaid-service obligation and records service revenue according to the event's idempotent accounting key. Attributable downstream cost accrues expense/payable separately.

Historical ledger rows created under an older event model remain historical accounting records. They must not be destructively relabeled as new canonical attempt-fee events; corrections use compensating entries where required.

## Distributable calculation

The payout basis remains:

```text
final treasury assets
- customer liabilities
- unpaid operating liabilities
- pending or ambiguous owner payouts
- required operating reserve
= owner distributable amount
```

The default reserve policy is 20% with a $25 minimum after real earned revenue exists. Both are configurable. The payout engine must not treat customer prepaid liability, merchant transaction value, or unproven external balances as owner profit.

Settlement ambiguity can still block or constrain owner distributions when it creates unresolved external obligations or prevents reliable reconciliation, even though an already accepted canonical x402 attempt fee is non-refundable merely because downstream execution later failed.
