# Production recovery — 2026-11-18

## Restore point and scope

Inspected main: `6a7c27ed9da0489a104c215aff28e514b18f86f4`.
Production before this work: `af1f5fdb-df3d-4c4d-9e3c-2b1bd78d1868`,
source tag `git-6a7c27ed9da0`, 100% ready in the authenticated provider dashboard.
The source is preserved on `recovery/full-production-20261118-6a7c27e`.
Supporting changes from draft #627 are included; payment writer 4, all durable
bindings, historical observations, balances and treasury remain compatible.

## Actual Sandbox recovery

The app's full Client ID matched the isolated preview. Replacing its encrypted
stored secret with the existing matching Sandbox app secret resolved
`paypal_oauth_invalid_client`. No provider key was generated or published.
The preview retains separate payment/receipt Durable Objects and no production
settlement service binding.

Actual provider Sandbox order creation, buyer approval, capture, signed webhook
verification, automatic task delivery, signed receipt verification and private
result recovery passed. Duplicate creation and unsigned webhook rejection were
also checked. No live transaction was submitted. Detailed provider identifiers,
receipts, proof bytes and transaction evidence are retained privately for the
owner and are deliberately excluded from this public repository.

Sandbox success alone does not prove live credential validity, receiving
eligibility, guest-card availability or a funded production capture.

## Public read capacity

A 15-second memory cache inside each existing LiveShard coalesces repeated
public fact/entity/history/change reads across edge representations. It holds
at most 128 values of 8192 characters each, is invalidated by measured writes
(including collection failures and suppression), and re-evaluates fact expiry
on every hit. It never wraps paid-read, financial readiness, authorization,
balances, receipt signing or settlement. Eviction needs no durable write.

Paired actual workerd SQLite with the exact main baseline reduced reads for
128 repeated public fact requests from **768 to 6** (99.21875%). Paid read
queries stayed **12 to 12**. Catalog contents, public previews, observation
writes and history matched. This is a repeat-request fixture measurement, not
an account-wide production reduction or a guarantee of free-tier availability.
See `docs/evidence/commerce/public-read-budget-20261118.json`.

On a known quota error only, public aggregate pages may use an existing dated
snapshot up to six hours old, with explicit degradation and no-store headers.
Retries have a fixed 60-second backoff. Strict health/readiness keeps its
authoritative path and still fails closed. Financial operations never use the
public snapshot. Unrecognized errors and expired/missing snapshots stay 503.

The existing provider usage audit can now warn from the UTC-day average rate
before consumption reaches 50%; actual 50/75/90% alerts and failure at 90%
remain. Missing or invalid SQLite counters cannot become healthy zero usage.
Each audit writes aggregate counters and projection limits to its job summary.
Optional subscription API 403s are distinct from working SQLite analytics; no
billing or observability permission was broadened.

## Current discovery evidence

Independent production probes passed public facts, x402 unpaid boundaries,
Glama ownership files, public analytics policy, private checkout noindex and
product sitemaps. GBLIN checkpoint 227 matched the upstream root, independently
verified log and witness signatures, and showed no current push error.
Google Search Console showed the existing sitemap successfully processed with
12,639 discovered pages; indexing reports were still processing. Discovery is
not equivalent to indexed pages, buyers or revenue.

Cloudflare Web Analytics records browser visits with bots excluded. Known owner
and diagnostic sessions must not be reported as acquired customers. No organic
customer acquisition or net live revenue is established by this release.

## Validation and release

Required release gates include strict types/static security, behavioral tests,
actual SQLite/ES256 checkout and source fixtures, exact-base read measurements,
protocol/settlement compatibility, CodeQL and the existing guarded canary.
No financial transaction, paid resource purchase, plan upgrade or data reset is
part of this supporting recovery change. Record the actual deployment run and
post-release provider usage separately; local tests are not deployment proof.
