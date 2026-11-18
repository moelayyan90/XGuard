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
## Live credential verification and subsequent canary

A follow-up owner-only endpoint verifies the existing Live OAuth pair without
creating an order, capturing funds, confirming merchant eligibility or changing
either payment gate. Authentication errors remain failures, and the access token
is discarded. The credential-check workflow reuses existing encrypted operator
and provider credentials without expanding permissions.

The first recovery deployed successfully as Worker version
`c52d0733-e1b2-46e8-a155-6a59b92775b8`, source `git-c676b4365a69`.
It used the existing coordinated deployment path because a settlement test fixture
changed. The follow-up release policy gives compatible relay runtime changes a
5% canary even when settlement test fixtures change; settlement runtime, config,
dependencies, billing and Durable Object/financial compatibility guards retain
their coordinated deployment requirements. Canary promotion retains exact-version
checks, propagation waits and the existing automatic rollback path. No production
failure is injected merely to demonstrate rollback.

Live checkout remains disabled. The authenticated merchant account shows an
unconfirmed withdrawal card. OAuth success does not prove card acceptance,
withdrawal eligibility or a real sale. No new confirmation charge, live purchase,
refund or transfer was initiated in this recovery.

The second release deployed as `e74efa27-68f2-4135-a3d8-0aa2384b5c1d`,
source `git-e07704b7fe25`, through a successful 5% canary and 100% promotion.
Deployment run: https://github.com/moelayyan90/XGuard/actions/runs/44245248212.
The no-transaction Live credential workflow fails explicitly because the
existing operator credential is not available to Actions. It is not replaced,
rotated or bypassed. Provider OAuth validity remains unproven until that
credential can authenticate the operator-only check.

## Directory readiness follow-up

The live Glama connector is ownership-verified and approved. Its human-readable
description was updated to distinguish working public facts/x402 services from
pending PayPal Live activation. The directory identified missing titles on 49
of 53 tools. The follow-up supplies titles for every advertised tool and adds
service-selection guidance without removing or renaming any tool or paid
service. The paid web-fetch annotation now conservatively reflects its possible
payment/ledger effects; public preflight and fact reads retain their existing
safety hints. Actual modern and legacy clients, x402 rejection and receipt
recovery remain required checks.

## Bounded collector reads

Post-release account counters still projected above the free daily allowance.
The source collector now has a persistent, collector-only 100,000-row allocation
per fixed shard per UTC day (3.2M across 32 shards), with a 4096-row safety margin.
An initial mid-day rollout receives only 75% of its remaining-day fraction.
Each active alarm checkpoints measured SQLite reads including its scheduling
queries once; it stops further source work near the allocation and schedules
resumption after UTC midnight. Paused alarms do not repeatedly write counters.
The small bounded scheduling/paused metadata reads are outside this allocation;
it is not an account-wide remaining-balance claim or a traffic-volume guarantee.

Contention no longer causes unbounded repeated source scans after this local
allocation. Sources, current facts, immutable history, financial objects, balances
and payment gates are preserved. Public fact reads and paid reads remain available
through their existing contracts. Delayed source verification ages to STALE; no
freshness is invented and no automatic allowance or plan purchase is made.

Paired real workerd SQLite using an equal 80-source fixture, 64 forced contended
alarms and a small test allocation measured **20,936 to 920 reads** and **69 to 9
writes**. The budget survived Store recreation, resumed after UTC rollover,
rejected malformed counters, and retained the original public value/history and
uncached paid reads (12 to 12). See
`docs/evidence/commerce/collector-read-budget-20261118.json`. This fixture proves
the pacing boundary, not a measured full-day production reduction.
