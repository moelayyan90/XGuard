# Payment and traffic recovery — 2026-11-17

## Production baseline and rollback

The inspected production release was `git-6e50a95ff973`, Worker version
`92895a11-8a17-40e9-a717-389a06aebde1`. The baseline commit is preserved on
`recovery/payment-traffic-20261117-6e50a95f`. Normal production CI still snapshots
the actual active version, checks durable-state compatibility, runs provider
capacity preflight and verifies the deployment before retaining it. This release
does not change bindings, migrations, treasury, payment writer version or prices.

## Payment findings and exact remaining activation

`GET /v1/checkout/config` on the baseline returns `ready:false` and all of:

- `paypal_client_id_missing`, `paypal_client_secret_missing`
- `paypal_merchant_id_missing`, `paypal_webhook_id_missing`
- `receiver_ownership_unverified`, `merchant_activation_pending`
- `card_writer_activation_pending`, `payment_environment_unverified`

Cloudflare's Variables and secrets UI also showed no PayPal entries. The card
notice accurately reflects these missing dependencies. The owner PayPal browser
session currently requests sign-in, so this inspection cannot establish current
merchant identity, receiving eligibility, restrictions or live captures. A prior
account inspection is documented in `action-cloud-20261116.md`; it is not a fresh
account authorization or evidence of a successful payment. Do not infer identity
from a public PayPal.Me link.

The existing flow already binds server-priced USD orders to the merchant and
receiver, claims capture once, reconciles lost replies with read-only requests,
verifies webhook signatures through PayPal, stores provider fee breakdowns,
and signs the persisted result. Refund/dispute holds block redelivery. Failed
delivery records a refund liability; no automatic refund transfer is authorized.
Existing workerd tests exercise these paths with intercepted provider traffic.

This patch permits a distinct `PAYPAL_SANDBOX_RECEIVER_EMAIL` only while
`PAYPAL_ENVIRONMENT=sandbox`. Its value must match `PAYPAL_VERIFIED_EMAIL`.
Previously a real developer Sandbox merchant's generated email could not match
the hard-coded live receiver. Live orders remain fixed to the owner's requested
`moelayyan2026@gmail.com`, even if the Sandbox variable exists. Malformed webhook
certificate URLs now return a signature-boundary 401 instead of a generic 503.

To finish, the owner must sign in to PayPal and authorize the actual XGuard app.
Verify the receiver email and merchant ID in that account; obtain scoped Sandbox
and live credentials privately; register the existing webhook URL
`https://xguardgate.com/v1/checkout/webhooks/paypal`; and test actual Sandbox buyer
approval/capture/delivery/recovery. Never paste secrets into git or public logs.
After provider approval and Sandbox evidence, a separate compatible writer
activation can enable live orders. A real charge/refund still needs a specified
funded owner authorization. No real payment, refund or live authorization was
performed by this patch. Synthetic captures establish no revenue.

Official qualification references, checked on 2026-11-17:

- [PayPal Standard Checkout](https://developer.paypal.com/checkout/integrate):
  available where PayPal is available; actual account access is still required.
- [Expanded Checkout](https://developer.paypal.com/studio/checkout/advanced):
  separately qualified card fields; do not assume Jordan merchant eligibility.
- [Jordan receiving terms](https://www.paypal.com/jo/legalhub/paypal/recpymt-full?country.x=JO&locale.x=en_JO):
  receiving/withdrawal verification requirements are account dependent.
- [PayTabs onboarding](https://support.paytabs.com/en/support/solutions/articles/60000716345-merchant-s-onboarding-journey):
  Jordan is supported, but this individual needs actual merchant/KYC approval
  and bank-settlement terms. No PayPal settlement capability is established.
- [Lemon Squeezy payouts](https://docs.lemonsqueezy.com/help/getting-started/getting-paid):
  the current site says new sign-ups have stopped and service will close on
  2027-03-31. Existing integration is preserved; it is not proposed as a new
  merchant activation workaround.

## Traffic findings and repairs

Network analytics records continuing requests while Web Analytics reports no
recent browser visits. HTTP unique visitor counts include automated traffic and
are not unique people. Worker/DO invocations include alarms and internal RPCs.
Detailed account traffic figures are not committed to this public repository.

The actual homepage contained an automatically injected
`static.cloudflareinsights.com/beacon.min.js` script without a nonce, while its
CSP allowed neither that origin nor a matching nonce. Product, network and compute
routers also used policies that blocked it. A missing beacon permission is a
verified measurement defect; it does not establish the size of the human audience
or explain every historical traffic change. Public HTTP analytics also contains
historical 5xx responses. Equal time windows and bot classification are required
before attributing a real audience drop.

A shared response boundary now permits only the existing Cloudflare script and
collector origins on successful public apex HTML. It keeps existing PayPal CSP,
nonces, frame restrictions and all other directives. It performs no DO writes and
injects no extra beacon. Private checkout/task recovery/owner routes, APIs, errors,
JSON and Markdown retain their previous restrictions. Public privacy text now
describes this existing analytics processor accurately.

Public Action pages have distinct descriptions, canonical Open Graph URLs,
Twitter summary metadata and nonced WebPage/WebSite structured data. Structured
data makes no unverified sale or availability claim. Private pages explicitly
remain noindex. The site sitemap now includes existing product detail pages,
compute availability, operator identity and payment policy pages; no retired API
or unsafe legacy route is restored. A direct HTTP probe also found that the apex served HTML over HTTP; the entrypoint now redirects all public HTTP domains to canonical HTTPS before any storage or payment operation, preserving paths, query strings and API host identity.

## Verification

- `npm run check`: syntax, static security checks, strict TypeScript.
- `npm test`: includes public router/CSP/private-page/sitemap regressions and
  Sandbox/live recipient isolation.
- `npm run build`: actual Worker dry-run bundle.
- `node apps/relay/test/action-cloud-workerd.mjs`: real SQLite and receipt
  signatures, simulated provider calls only, no real charge.
- `npm audit --prefix apps/relay --omit=dev --audit-level=moderate`.
- Normal repository CI still checks GBLIN/C2SP, MCP, A2A, x402, settlement safety,
  durable budgets and compatibility. Existing measured catalog/telemetry budgets
  remain intact; no limit evasion or service shutdown is introduced.
- Deployment additionally runs `scripts/traffic-production-check.mjs`, labeled
  synthetic and executing no browser JavaScript. It checks policy, metadata and
  sitemap contracts; it cannot prove provider beacon ingestion or human visitors.

For browser ingestion, load one identified test page, leave/navigate away so the
beacon flushes, and inspect its row in Cloudflare Web Analytics after processing.
Record that as a test session, not customer growth. Script permission alone is
not ingestion evidence. External Google/Bing account access and any directory
acceptance must be verified independently before claiming submission or recovery.
