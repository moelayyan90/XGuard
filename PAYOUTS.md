# Owner payouts

XGuard has a technically live Base mainnet treasury receiving path, but **treasury receipt is not the same as owner payout or owner profit**.

Merchant top-ups are native Base USDC deposits to the configured treasury address. Those deposits create merchant prepaid service balances and are customer liabilities. Only XGuard service fees that satisfy their configured billable event become gross earned revenue.

## Current canonical x402 money flow

```text
merchant Base USDC top-up
        ↓
configured crypto treasury address
        ↓
merchant prepaid liability in XGuard accounting
        ↓
authenticated + supported x402 economic request
        ↓
canonical logicalPaymentKey + sufficient prepaid balance
        ↓
$0.03 accepted-attempt fee earned once
        ↓
downstream verify / settlement execution
        ↓
independent settlement truth / reconciliation runs separately
        ↓
downstream + infrastructure + other liabilities/costs
        ↓
required operating reserve
        ↓
owner distributable amount, if any
```

The fixed x402 fee is **$0.03 / 30,000 micro-USD once per accepted authenticated economic attempt**. It is earned before downstream execution after authentication, supported-request parsing, canonical `logicalPaymentKey` derivation and successful prepaid-balance reservation. A downstream failure does not refund an accepted attempt, and an idempotent retry for the same logical payment key adds no second fixed fee.

Independent Base finality remains authoritative for the **truth of the expected USDC settlement**, not for the timing of the canonical accepted-attempt fee.

The physical USDC treasury can therefore contain a mixture of customer prepaid liabilities and earned XGuard funds. The entire wallet/exchange balance must never be treated as withdrawable owner profit.

## OKX treasury verification

XGuard includes `npm run ops:okx-treasury-check` and the manual GitHub Actions workflow **Verify OKX treasury**. The check is intended to use an authenticated, read-only OKX API key to prove that the configured public Base USDC treasury address belongs to the authenticated account and that the relevant deposit route is available for that account/entity.

The verification uses encrypted GitHub Actions secrets such as `OKX_API_KEY`, `OKX_API_SECRET`, `OKX_API_PASSPHRASE`, and the configured `XGUARD_TREASURY_USDC_ADDRESS`. Do not put exchange API credentials in source, logs, issues, pull requests, or example environment files. Receiving treasury funds does not require XGuard source code to possess exchange trading or withdrawal authority.

A repository workflow or implementation is not evidence that the account has actually passed the external verification. The result of the authenticated check is the relevant evidence when it is run.

## Automatic owner payout status

No automated regulated fiat/bank off-ramp connector is established merely by the existence of accounting or payout-policy code. A crypto treasury and earned XGuard revenue can exist while owner bank payout remains an external operational/compliance step.

`AUTO_OWNER_PAYOUT=true`, where present in portable/reference components, expresses a policy setting only. It is not a bank/exchange transfer credential and does not itself authorize money movement.

## Safety gate for any future automated payout

An owner-distribution connector should not submit a payout unless all relevant conditions are proven, including:

- destination ownership and provider eligibility;
- full coverage of merchant customer liabilities;
- unpaid operating/downstream obligations accounted for;
- pending or ambiguous owner payouts excluded;
- the required operating reserve funded;
- the payout amount derived from reconciled earned XGuard revenue rather than gross treasury balance;
- idempotent transfer submission and independently reconcilable final/returned status.

Settlement ambiguity can still affect treasury reconciliation or payout safety even though it does not retroactively refund an already accepted canonical x402 attempt fee.

## Current status

- **Base USDC treasury receiving path:** implemented/configured for mainnet operation.
- **Merchant prepaid liability accounting:** implemented in the production accounting path.
- **Canonical public x402 fee:** $0.03 once per accepted authenticated economic attempt.
- **Settlement truth/finality:** separate safety and reconciliation layer for the expected Base USDC transfer.
- **Automatic regulated bank/off-ramp owner payout:** not established by the repository alone.
- **Owner distributable amount:** must be computed from reconciled earned revenue minus customer liabilities, operating liabilities/costs, pending owner payouts and reserve; it cannot be inferred from the treasury balance.
