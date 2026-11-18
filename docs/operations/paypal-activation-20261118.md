# PayPal activation — 2026-11-18

The owner authorized creation of separate XGuard live and Sandbox PayPal apps,
encrypted Cloudflare credential storage, webhooks and Sandbox testing. No funded
live charge, refund or payout is authorized by that approval.

The signed-in account confirmed the requested primary email, an individual
Business account and Jordan as its country. Its account-capability view permits
live PayPal payments. PayPal Account Optional is already on. This does not prove
that every buyer will receive guest-card checkout or that Expanded Checkout is
available to this merchant. Current official Expanded eligibility excludes
Jordan; Standard guest eligibility is buyer dependent.

Both XGuard apps were created separately from the pre-existing Shopify app.
Unused Payouts, Subscriptions, Payment links and Mobile SDK capabilities were
disabled. Webhooks subscribe only to capture completion/pending/declined/denied,
refund/reversal and dispute-created events. The capture-declined event now
applies the same delivery hold as a denial.

Live credentials are encrypted in the production environment and retain
`PAYPAL_ENABLED=off`. Sandbox credentials and the separate test merchant identity
are encrypted in Previews Base only. Neither credential set is in git.

The dedicated configuration deploys a `paypal-sandbox` Worker Preview under
the existing `xguard-mainnet` Worker. Cloudflare gives this Preview independent
Durable Object namespaces. Only the test payment ledger and receipt signer are
bound; no production service binding, owner key, source collection or cron is
used. The preview boundary requires the Sandbox environment and the exact
preview origin, preserves same-origin checks, exposes checkout only and returns
noindex/no-store responses. Production hostname requests cannot use this flag
to enable Sandbox checkout. Live receiving identity remains fixed.

Dashboard encrypted-binding updates omit source annotations. Before the normal
production pipeline runs again, a narrowly scoped metadata repair compares the
current provider runtime modules with the last known CI deployment and preserves
every binding. The first attempt stopped because the ETag changed; it made no
production mutation. The revised check requires a matching SHA-256 for every
provider-returned runtime module and equal runtime compatibility settings. It
refuses unknown versions or different source bytes. It restores the proven git
tag only; it does not upload code or change payment gates.

Local tests also fix an existing UTC-clock-dependent alarm test: a late-day
prorated source allowance could pause its fixture before the intended scheduling
assertion. The unit test now uses a fixed test day. The actual workerd collector
tests share an isolated SQLite fixture with a full daily allowance in a test-only
subclass, while retaining the release fetch/alarm implementation. This covers the
collector, x402 reads, extraction, MCP/A2A and paired compatibility fixtures.
The domain-contention measurement uses equal admitted capacity on both releases.
Production budgets, source-quota enforcement tests and alarm pacing are unchanged.

Actual Sandbox provider approval, capture, webhook verification, signed delivery
and duplicate recovery must be recorded separately before activating the live
writer. Passing mocked tests or creating apps is not evidence of revenue.

The first isolated Preview deployed successfully but Cloudflare reported no
active URL. Its routing setup enables `previews_enabled` through the documented
subdomain API, preserving the production `enabled` setting and checking that
the deployed production version remains identical. The provider smoke creates
one actual Sandbox order, repeats its idempotent request, checks tenant isolation
and rejects an unsigned webhook. It contains no approval or capture request and
must never be reported as a completed payment.

The deployed Preview now returns `ready:true` for Sandbox configuration. Actual
provider checks stopped at OAuth authentication, before creating a PayPal order.
The protected ledger correctly retains an unconfirmed/review state and delivers
no result. A bounded provider error code is retained for diagnosis without raw
response bodies. The repository token cannot read Workers Observability events
(403), so this recovery code supplies the safe diagnostic instead. The connected
browser became unavailable; credentials must be rechecked in the existing PayPal
app and encrypted Preview configuration when that connection is restored. Live
purchasing remains off, with no real capture, refund or payout attempted.

Primary references checked:
- https://www.paypal.com/jo/cshelp/article/how-do-i-accept-cards-with-checkout-using-the-guest-checkout-option--help307?locale.x=en_JO
- https://developer.paypal.com/expanded/eligibility
- https://developers.cloudflare.com/workers/previews/configuration/
- https://developers.cloudflare.com/workers/previews/resources/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/edit/
- https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/get/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/methods/create/
