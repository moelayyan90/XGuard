# Owner payouts

XGuard now has a technically live Base mainnet treasury path, but **treasury receipt is not the same as owner payout or owner profit**.

Merchant top-ups are sent as native Base USDC to the configured treasury address. Those deposits create merchant prepaid service balances and are customer liabilities. Only service fees that later satisfy the successful-settlement and independent-finality boundary become gross XGuard earned revenue.

## Current money flow

```text
merchant Base USDC top-up
        ↓
configured crypto treasury address
        ↓
merchant prepaid liability in XGuard accounting
        ↓
successful billable settlement reserves $0.002
        ↓
independent Base finality succeeds
        ↓
$0.002 becomes gross XGuard earned revenue
        ↓
downstream + infrastructure + other liabilities/costs
        ↓
required operating reserve
        ↓
owner distributable amount, if any
```

The physical USDC treasury can therefore contain a mixture of customer prepaid liabilities and earned XGuard funds. The entire wallet/exchange balance must never be treated as withdrawable owner profit.

## Automatic owner payout status

No automated regulated fiat/bank off-ramp connector is active. The codebase contains accounting and payout-policy primitives, but it does not have authority to move money from the owner's exchange account or bank account and does not store bank credentials in the repository.

`AUTO_OWNER_PAYOUT=true`, where present in portable/reference components, expresses a desired policy only. It is not permission or a live transfer credential.

## Safety gate for future automated payout

A future payout connector must not submit an owner distribution unless all of the following are proven:

- destination ownership and KYC/AML eligibility are verified by the selected regulated provider;
- merchant customer liabilities remain fully covered;
- pending/ambiguous settlements and payouts are excluded;
- downstream and other operating liabilities are paid or reserved;
- the operating reserve is fully funded;
- the amount is derived from reconciled earned revenue, not gross treasury balance;
- the provider transfer is idempotent and its final/returned status can be independently reconciled.

## Current off-ramp research

Circle Mint was previously researched as a possible institutional off-ramp candidate. Country support or documentation is not account approval and does not establish that the owner, XGuard, or a particular bank account is eligible. A production provider must independently approve the account holder and issue scoped credentials before any automated bank payout can be activated.

The current mainnet treasury receiving path can function without a bank payout connector because earned funds can remain in the configured crypto treasury. That does **not** resolve regulatory classification, tax obligations, exchange terms, or owner-distributable accounting.

## Current status

- **Base USDC treasury receipt:** technically live.
- **Merchant prepaid liability accounting:** implemented.
- **Earned-fee finality boundary:** implemented.
- **Automatic bank/off-ramp owner payout:** not active.
- **Owner distributable profit:** must be computed from reconciled earned revenue minus liabilities, expenses, pending amounts, and reserve; it cannot be inferred from the exchange balance.
