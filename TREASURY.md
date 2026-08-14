# Treasury

XGuard treats merchant prepaid funds as liabilities until a billable service event completes. Gross revenue is never called profit.

| Measure                                            | Meaning                                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `CUSTOMER_BALANCES` / `MERCHANT_PREPAID_LIABILITY` | XGuard owes service or a refund to merchants                                 |
| `EARNED_REVENUE` / `XGUARD_SERVICE_REVENUE`        | fees earned from final successful billable settlements                       |
| `OPERATING_EXPENSE`                                | facilitator, compute, database, network, monitoring, and off-ramp cost       |
| `FACILITATOR_PAYABLE`                              | incurred but unpaid downstream liability                                     |
| `OPERATING_RESERVE`                                | earned funds retained for continuity                                         |
| `OWNER_DISTRIBUTABLE`                              | final funds remaining after liabilities, costs, pending payouts, and reserve |
| `PAID_TO_OWNER` / `OWNER_DISTRIBUTIONS`            | distributions proven paid                                                    |

Every Node ledger transaction must sum to zero. Top-up posts treasury asset against merchant prepaid liability. Fee capture debits the liability and credits earned service revenue. Downstream cost accrues expense against a payable. A final owner payout debits owner distributions and credits treasury asset.

## Distributable calculation

The payout basis is:

```text
final treasury assets
- customer liabilities
- unpaid operating liabilities
- pending or ambiguous payouts
- required operating reserve
= owner distributable profit
```

The default reserve policy is 20% with a $25 minimum after real revenue exists. Both are configurable. The payout engine uses the lesser of required and actually available reserve as the current funded amount, then blocks payout whenever the funded reserve is below the requirement.

Customer liabilities, unsettled funds, ambiguous settlements, and merchant transaction value are never distributable to the owner.
