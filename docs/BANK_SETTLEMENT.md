# XGuard Operations — Bank Settlement Policy

## Commercial payment rail

XGuard Operations / EUDR commercial payments use a bank-settled card payment rail. They do **not** use the legacy x402/USDC treasury.

Target provider: PayTabs / MEPS Jordan.

Payment flow:

1. Customer pays XGuard by card through PayTabs Hosted Payment Page.
2. XGuard records the order and PayTabs transaction reference.
3. XGuard treats payment as successful only after server-side verification reports an authorised transaction.
4. PayTabs/MEPS settles merchant funds to the bank account/IBAN configured and approved on the merchant profile, subject to the merchant agreement and settlement schedule.
5. The legacy x402 USDC treasury remains isolated from Operations/EUDR revenue.

## Production gate

Operations checkout MUST remain disabled until all of the following are configured as secrets or approved merchant settings:

- PAYTABS_PROFILE_ID
- PAYTABS_SERVER_KEY
- PayTabs Jordan merchant account approved
- Merchant bank account and IBAN verified by PayTabs/MEPS

No source-code default may contain a bank account, IBAN, PayTabs Server Key, or merchant credential.

## Jordan endpoint

Use the PayTabs Jordan API endpoint for the approved Jordan merchant profile:

- Payment request: `https://secure-jordan.paytabs.com/payment/request`
- Transaction query: `https://secure-jordan.paytabs.com/payment/query`

The public website may display commercial prices before activation, but it must not claim that live card checkout is available until the production gate above is satisfied.
