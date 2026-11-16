# XGuard Action Cloud — supporting release, 2026-11-16

## Actual scope and commercial status

This release adds one bounded execution service, **CSV cleanup and exact-key
deduplication**, to the existing Worker. A task costs **$2.00 USD** through the
human checkout, with no subscription. Inputs: UTF-8 CSV, at most 64 KiB,
2000 data rows, 40 columns and 4096 characters per cell. Outputs: `clean.csv`,
`duplicates.csv`, and `report.json`. Quoted delimiters/newlines are supported;
malformed records fail before payment. Downloads escape spreadsheet formulas.
Values are not inferred or enriched by an AI model.

The same registry derives card checkout for every current `LIVE_PAID` service,
including extraction, stored exports, routing, discovery, HTTP checks and durable
bounded public-read tasks. Existing x402 prices are unchanged. Human checkout
has a $2 minimum because card fixed fees make micro-transactions uneconomic.
Compute/GPU is **not** offered for card purchase: its approved funded provider
and tested card execution adapter are still missing. No general arbitrary-code,
unrestricted browser-agent or universal external-action engine is claimed.

The release is technically testable, but new production card purchases remain
disabled. No PayPal credential was copied, rotated or created during the account
inspection. No funds were moved. No independent XGuard customer sale or net
profit was established. The account dashboard is not a complete revenue audit.

## Paid-market evidence and choice

Primary sources reviewed on 2026-11-16:

| Category | Published evidence | Decision |
| --- | --- | --- |
| CSV onboarding / cleanup | [Dromo pricing](https://dromo.io/pricing) offers Professional at $599/month, 250 imports included and $3 per additional import. [Waycool customer case](https://try.dromo.io/blog/waycool-migrates-from-flatfile-to-dromo-in-under-an-hour-and-saves-big) describes switching vendors and saving over $12000/year. | Choose a narrow deterministic cleanup task with a measurable output and no external prepaid API. These are vendor-published customer claims, not independently audited invoices. |
| Recurring data import | [Flatfile / Peoplelogic case](https://flatfile.com/resources/case-studies/peoplelogic/) reports reducing onboarding from 3 hours to 30 minutes and recurring weekly/monthly imports. | Supports recurring operational need, but does not establish that these companies will buy XGuard's smaller service. |
| Web extraction | Existing XGuard implementation, robots/SSRF limits and result contract. | Reuse as a secondary adapter; no claim that XGuard has verified paid extraction customers. |
| Inference / GPU proxy | Existing compute implementation and [activation record](compute-gateway-20261115.md). | Remains unavailable without an eligible funded upstream; not a substitute for validated delivery. |

Initial discovery channels are the existing XGuard marketplace, search-indexable
task pages, REST/OpenAPI, MCP and A2A. Additional directory submissions and
commercial promotion should follow an economic canary and accurate availability.
No spam, invented customers or fabricated marketplace demand is used.

## Payment provider assessment

The requested receiving PayPal account was inspected through its signed-in UI.
Its primary email matches `moelayyan2026@gmail.com`; it is a Business account,
with an individual business profile in Jordan. `PayPal Account Optional` is
already enabled. There is one existing live REST app, `MyApp_Shopify`, with no
registered live webhooks. This is account evidence, not a successful payment.
The existing app was not repurposed or granted additional access.

| Provider | Jordan / merchant qualification | Pricing, currency and settlement | Result |
| --- | --- | --- | --- |
| PayPal Standard Checkout | [REST country codes](https://developer.paypal.com/api/codes/country-region/) include JO for Business accounts. Existing individual Business profile and optional-account setting were observed. Final processing ability still needs live credentials, provider checks and a funded canary. | [JO fees](https://www.paypal.com/jo/business/paypal-business-fees): standard JO commercial rate 4.90% plus fixed fee, USD fixed fee $0.30. [Checkout page](https://www.paypal.com/jo/business/accept-payments/checkout) advertises no monthly/setup fee. Currency conversion, withdrawal, disputes and account-specific terms are separate. | Selected because it meets the requested PayPal destination and uses an existing account. No subscription purchased. |
| PayTabs | [Jordan product](https://ai.paytabs.com/en/jordan-payment-gateway/) and [onboarding](https://paytabshelp.freshdesk.com/en/support/solutions/articles/60000716345-merchant-s-onboarding-journey) explicitly include Jordan. [Regional KYC page](https://ai.paytabs.com/en/onboarding-documentation/) directs Jordan requirements to its team. Individual eligibility was not established. | Jordan page offers local-currency settlement, international cards, APIs and iframe integration. [FAQ](https://ai.paytabs.com/en/faq/) lists USD/JOD/SAR/EUR/AED/ILS processing in Jordan. Fees, reserve, minimum ticket, bank account ownership requirements and digital-service acceptance need an actual merchant offer. | Alternative, not silently registered or activated. It does not directly settle to the requested PayPal balance. |
| MEPS / Mastercard Gateway | [MEPS](https://www.mepspay.com/) offers e-commerce acquiring in Jordan. [Mastercard release](https://mastercardcontentexchange.com/news/eemea/en/newsroom/press-releases/en/2026/january/meps-introduces-click-to-pay-through-mastercard-gateway-in-jordan/) confirms Click to Pay. | Merchant agreement, individual eligibility, KYC, card wallet availability for this merchant, per-transaction pricing, setup/monthly fees, settlement timing and small-ticket approval remain unverified. | No account created and no fee assumptions made. |
| HyperPay | [Official FAQ](https://www.hyperpay.com/frequently-asked-questions/) includes Jordan and country-dependent documents/pricing. | Card/wallet products are offered, but specific JO individual approval, Apple/Google Pay onboarding, currencies, bank payouts, fees and AI-service restrictions require written/account confirmation. | No claim of eligibility for this operator. |
| Jordanian bank gateway | [Arab Bank](https://www.arabbank.com.jo/mainmenu/home/SMEs_Banking/digitalization-and-innovation/payment-gateway) offers Visa-powered Cybersource for local/international cards and website integration. | Merchant enrollment is required. Public product page does not establish this individual's approval, full KYC list, fees, wallets, currencies, minimum ticket or settlement terms. | Fallback acquiring route only; would not automatically deposit into PayPal. |

[PayPal guest checkout](https://www.paypal.com/jo/cshelp/article/how-do-i-accept-cards-with-checkout-using-the-guest-checkout-option--help307)
is risk- and buyer-dependent. The enabled account setting does not guarantee a
guest option for every buyer. [Advanced card fields country table](https://developer.paypal.com/platforms/checkout/advanced)
does not establish JO eligibility; hosted card fields, Apple Pay and Google Pay
are not advertised as activated. The SDK renders only eligible funding sources.
Standard Checkout can open PayPal's secure checkout in addition to bank 3DS;
an exclusively embedded no-PayPal-page experience is not guaranteed.

For a $2 task, 4.90% + $0.30 implies **$0.398** processing and **$1.602** remaining
before infrastructure, conversion, withdrawals, refunds, disputes and tax. This
is an estimate, not realized net profit. CSV processing has no upstream API fee;
Worker/DO expenses are unknown until actual usage and invoices are reconciled.
Receipts preserve actual provider fee breakdown when supplied and keep unknown
infrastructure/net profit as null. Do not treat configured limits as expenses.

## Runtime and financial boundaries

- Routes: `/marketplace`, `/checkout`, `/dashboard`, `/action/docs`,
  `/action/pricing`, `/action/how-it-works` and `/v1/checkout/*`.
- `POST /quote` validates bounded input without storing a paid order or fetching
  a customer URL. Server-derived prices cannot be supplied by the buyer.
- `POST /orders` requires a random recovery token and stable idempotency key.
  The client stores its deterministic order ID and capability **before** the
  provider request. CSV contents are not retained in localStorage.
- PayPal purchase unit binds order/reference/custom/invoice IDs, USD amount,
  requested receiver email and verified merchant ID. Browser approval, redirects,
  screenshots and unsigned callbacks are never payment evidence.
- Capture has one transactional claim and a stable provider request ID. Lost
  capture replies use **read-only order reconciliation**; no automatic recapture.
- [Webhooks](https://developer.paypal.com/api/rest/webhooks/rest/) use PayPal's
  signature verification API with a pinned PayPal certificate-host policy,
  then reconcile the known canonical order. Signed reversals/refunds/disputes
  stop further private result delivery. Unknown transactions are ignored.
- Only confirmed exact `COMPLETED` captures can fund execution. Per-order DOs
  isolate capabilities and claims. GET/recovery never creates a new purchase.
- CSV work is deterministic. Existing external adapters are bounded public reads
  and retain robots/DNS/SSRF controls. Received pages are data, never agent
  instructions. No customer credential or arbitrary command is executed.
- Durable scheduled tasks checkpoint their original task ID; Action Cloud waits
  for `COMPLETED` before recording successful delivery. Failed/uncertain tasks
  become an explicit refund/reconciliation obligation.
- Output is persisted in bounded chunks before ES256 receipt signing. A signer
  outage retries signing without repeating a completed task. Receipts bind input
  and output digests, exact capture, price, environment and accounting status.
  The browser verifies signature and result digest before offering downloads.
- Transient paid failures retry at most 3 times with exponential backoff.
  Workflow recovery polling is bounded to 30 wakes around the actual schedule.
  Unconfirmed financial outcomes require reconciliation rather than guessing.
- New orders default to 100/day and 10/day per hashed trusted caller IP. No
  permanent scheduler, extra namespace, plan upgrade or prepaid credit purchase
  is introduced. Existing account-wide Cloudflare quotas can still block work.
- Results are recoverable for 30 days. Raw inputs are removed after success;
  terminal content is purged on its retention alarm. Financial metadata,
  immutable signed receipts, digests and audit transitions remain available.
- The private existing-owner endpoint `/admin/action-cloud?order_id=...` inspects
  one order without exposing its raw input or recovery token. It requires the
  configured operator Bearer key and performs no unbounded scan.

## Safe release and account activation

Existing Worker classes, bindings, migrations, GBLIN witness identity,
legacy settlement balances and receipts are unchanged.

1. Deploy this **reader-5 / writer-4 supporting release** using the normal CI,
   production snapshot, provider-capacity preflight, code-only canary and rollback
   safeguards. Its code refuses all live card writes even if secrets exist.
2. Obtain action-time owner approval before granting XGuard access to live PayPal
   credentials or configuring new financial notifications. Prefer a dedicated
   least-privilege XGuard app; do not rotate or expand the Shopify app silently.
3. Verify the real receiving account and merchant ID. Store only in Worker secrets:
   `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID`,
   `PAYPAL_WEBHOOK_ID`, `PAYPAL_VERIFIED_EMAIL`, `PAYPAL_ENVIRONMENT=live`,
   `PAYPAL_ENABLED=on`. The verified email must match the fixed requested receiver.
   Never put the secret in git, issue bodies, browser URLs or logs.
4. Register `https://xguardgate.com/v1/checkout/webhooks/paypal` for
   `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`,
   `PAYMENT.CAPTURE.REVERSED`, `CUSTOMER.DISPUTE.CREATED`. Registration and
   credential access remain an account-side action, not proof that events work.
5. Only after reader 5 is verified, activate writer 5 in a separate code release.
   All rollback candidates must then retain reader 5. Dashboard-only secret
   activation cannot bypass the committed writer safety gate.
6. A **real $2 canary and refund require the owner's specific funded approval**.
   Use the same order through capture, execution, recovery and reconciliation.
   Preserve private receipt evidence without publishing buyer tokens or identity.

## Verification and remaining limits

`node --test apps/relay/test/action-cloud.test.mjs` covers CSV boundaries,
all-current-service registry membership, receiving-identity binding and truthful
unactivated checkout. `node apps/relay/test/action-cloud-workerd.mjs` exercises
actual SQLite DO transactions and ES256 receipts while intercepting **all**
provider network calls. It covers simultaneous create/capture, capability
isolation, lost capture reply, storage failure after capture, amount mismatch,
unsigned/invalid webhooks and daily capacity. These are synthetic payments.
The suites are included in CI along with legacy financial/witness tests.

Pending: real PayPal credential/webhook connection and funded canary; automated
refund authority and real refund test; external inference/GPU card adapter;
actual infrastructure invoice ingestion; verified independent customer sales;
cross-device accounts beyond capability-file import; arbitrary platform actions
and unrestricted agent execution. Failed card delivery currently records a
refund liability requiring the operator's financial authorization. Do not call
this a fully autonomous, commercially activated marketplace until those material
payment/delivery conditions have been satisfied.

The visual direction was reviewed against Pinterest's minimal SaaS search:
neutral surfaces, restrained green accents, quiet type hierarchy and explicit
checkout totals. No reference artwork is copied into the product.
