# Additional paid Live data services

This is an additive API over XGuard Live's existing published observations. Public fact, history, change, topic, search, HTML, Markdown and JSON routes remain free. Source collection, cron, official-host restrictions, freshness rules, suppression, immutable evidence, robots.txt and sitemap generation retain their existing contracts. No Cloudflare crawler charging rule is enabled by this release.

## Audit and limits of the evidence

The pre-change production revision was `0c47e4cfe446864d6f28ea3a63ab432fff5209a1`. On 2026-10-19, public identity and robots returned 200, but data-dependent routes returned `503 storage_write_quota_exhausted` before these changes. The paid catalog did not exist. `/pricing`, `/v1/payment/readiness`, `/mcp` and the retired marketplace routes returned 410 because the Live migration intentionally removed the previous public product. Preserving their financial classes does not make those old sales routes active.

The existing exact x402 engine contains durable payment identifiers, authorization nonce reservations, verification/settlement stages, ambiguous-settlement reconciliation, signed quotes, receipts, ProofRail and private result recovery. These financial components are reused; the retired extraction or marketplace product is not reopened. Existing obligations and records are preserved.

The separate `apps/billing` Worker serves Lemon Squeezy credit/checkout infrastructure. Its public health response does not prove configured webhook secrets, successful checkout or settlement, and that credit ledger is not connected to these new Live purchases. The configured Base USDC receiving address is syntactically valid, but configuration and readiness checks do not prove the owner's control of its private key. No key or real owner-funded purchase is needed or used by the test suite.

The read-only xpay `/supported` endpoint advertised x402 v2 exact on Base on 2026-10-19. This is protocol support, not proof that a buyer authorization has verified or settled in production. Neither bot requests, successful pages, quotes, signatures, nor fixture transactions establish commercial revenue.

Cloudflare monetization stays `MONETIZATION_MODE=observe`. Pay Per Crawl is documented as a closed beta; Pay Per Use is a separate beta and buyer-reporting program. Account eligibility, accepted buyer terms, dedicated payout onboarding and country availability must be confirmed inside the account. Authenticated account verification was blocked by the provider sign-in flow during this audit. No eligible account, active payout or paid crawl is claimed. See [operations](OPERATIONS.md) for the existing provider-report workflow.

## Catalog and purchase contracts

Base URL: `https://api.xguardgate.com/api/paid/v1`.

| Service | POST path | Fixed price | Bounded result |
|---|---|---|---|
| Evidence-backed fact bundle | `/batch` | 0.01 USDC / 10,000 atomic | 1–20 canonical public fact IDs, current freshness labels, timestamps and evidence |
| Historical export | `/history` | 0.02 USDC / 20,000 atomic | One fact, explicit UTC range, at most 300 stored observations and 90 KB per page |
| Observed-value comparison | `/compare` | 0.02 USDC / 20,000 atomic | One fact, last stored observation at or before each of two UTC times |

Prices are initial offers, not measured market willingness to pay. Each history continuation is a separate, explicitly authorized purchase at the published price; no automatic paid pagination is performed. Missing facts or unobserved history are explicit UNKNOWN/null. A comparison is not proof of the value between observations. Source hashes establish byte identity and issuer signatures establish attribution, not independent factual truth.

`GET /catalog` returns service descriptions, exact prices, input and output schemas, example requests, limits, recovery links and verification instructions. Request `Accept: application/json` or `?format=json` for machine metadata. HTML is available for people. Successful public GET responses add an RFC 8631 `Link` with `rel="service-desc"`; existing canonical links and page bodies remain intact. Direct HTTP x402 is the implemented agent interface; the old MCP endpoint remains retired.

`GET /readiness` returns 200 only when enablement, production configuration, a published sample fact, proof authority, financial storage, circuit state and facilitator support all pass. Otherwise it returns 503 with the actual failed checks. The result is shared across concurrent requests and cached for at most 60 seconds per environment. A circuit check is repeated before each purchase. Readiness never asserts a real sale or receiving-wallet ownership.

Financial storage readiness requires a successful awaited write, not just a readable circuit record. A single fixed nonfinancial probe key is updated at most once per minute in the shared financial object; concurrent probes share that write across Worker locations and object restarts. Every purchase repeats this shared capacity/circuit gate even when its broader dependency readiness is cached. The check is a recent capacity observation, not a reservation of future account allowance. Actual payment-state writes and fail-closed settlement rules remain mandatory even while a successful readiness result is cached. Probe data never enters payment, revenue or profit counters.

All purchase inputs require an explicit string `max_amount_atomic` at least as large as the fixed price, plus an `Idempotency-Key` of 8–128 letters, digits, underscores or hyphens. JSON request bodies are limited to 16 KB, duplicate keys and unsupported fields are rejected, and arbitrary URLs are never accepted. Dates must be UTC ISO timestamps ending in Z. A historical continuation uses the returned `{ "observed_at": "...", "id": "..." }` cursor and the same range. Results are limited to 128 KB.

Example unsigned price request, which cannot authorize a payment:

```sh
curl --fail-with-body https://api.xguardgate.com/api/paid/v1/batch \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: buyer-order-example-001' \
  --data '{"facts":["npm/react/latest-version"],"max_amount_atomic":"10000"}'
```

When the dependencies are ready, the response is HTTP 402 with x402 v2 `Payment-Required` and an issuer-signed `X-XGuard-Quote`. No purchased result is returned. When capacity or payment configuration is unavailable, the response is 503 before any verification or settlement attempt. Public fact requests never enter this purchase path.

Use the official x402 client with an independently authorized buyer wallet to sign the exact requirement: Base `eip155:8453`, USDC asset `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, exact amount and configured payee. Preserve the original JSON, buyer cap, Idempotency-Key, signed quote and payment identifier. Retry that request with `Payment-Signature` and `X-XGuard-Quote`. Payment is verified and settled before data execution; the result is stored before signed delivery. Concurrent retries share a durable operation. A different authorization for an already reserved buyer idempotency key is rejected before a second settlement.

## Buyer SDK, recovery and receipts

`sdk/live-paid.js` wraps the existing bounded buyer client, checks the exact chain/asset/amount against the spending cap, and verifies issuer signatures and result digests locally. `onPaymentPrepared` must durably save the recovery record before the signed request is submitted. The CLI does this in private files with mode 0600:

```sh
node apps/relay/scripts/live-paid-buy.mjs --catalog
node apps/relay/scripts/live-paid-buy.mjs --help
# Only a separately authorized buyer supplies XGUARD_PAYER_PRIVATE_KEY locally:
node apps/relay/scripts/live-paid-buy.mjs --pay --service batch \
  --input INPUT.json --max-amount-atomic 10000
node apps/relay/scripts/live-paid-buy.mjs --recover PRIVATE_RECOVERY.json
```

Never put a wallet key in an argument, chat, source file or log. No real purchase command is part of CI or production smoke tests. Operator-funded tests, if separately authorized, must use `--synthetic` and do not establish independent customer revenue.

If delivery is uncertain, do not create another authorization. Call `GET /results/{payment_identifier}` with the original signed `X-XGuard-Quote`; this read-only operation does not settle again and accepts an expired purchase quote for result recovery. A pending/ambiguous response is not a successful delivery. Reconciliation retains its existing bounded retries and dead-letter state; a missing proof or unresolved settlement must not be shown as earned revenue. A post-settlement execution failure retains an unfulfilled obligation and the existing same-operation execution-credit/review mechanism rather than fabricating a refund or charging again.

For an explicit post-settlement execution failure, retain `error.details.execution_credit`. Once the data dependency recovers, repeat the identical input and Idempotency-Key with the original `X-XGuard-Quote` and `X-XGuard-Credit`, without a new Payment-Signature. A valid Live credit can fulfill the original obligation after its purchase quote expired, with new purchases paused or the payment provider unavailable; the credit itself must still be valid, and data/signing/financial storage plus the paid circuit must permit execution. A credit attempt cannot create a new settlement. Successful fulfillment stores the signed result against the original payment identifier, reports `cost.new_charge=false`, and releases the original unfulfilled liability exactly once. Its result and receipt are subsequently available through ordinary read-only recovery. A fixture test covers failure, paused purchases, expired quote, unavailable facilitator, invalid-credit rejection, redemption, replay, signature verification and unchanged settled cash.

`GET /proof-key` exposes the issuer's public JWK. `POST /verify-receipt` accepts `{ "receipt": "<receipt JWS>", "proof": "<ProofRail token>" }` and verifies signatures and their digest linkage, with a 30/minute rate limit. The local `verifyLiveDelivery` helper additionally binds the returned result bytes and settlement transaction. These are issuer evidence checks; independent on-chain review is separate. Recovery and verification stay available when new purchases are disabled.

## Cost and operational controls

The services read existing SQLite facts and indexed history. They make **zero new source-provider fetches** and never queue an accelerated refresh as part of a purchase. Batch execution groups at most 20 facts by the existing 32-shard placement. History reads at most 301 indexed observations and limits delivered rows/bytes. Comparison performs two indexed lookups. Published/suppressed visibility and stale-value behavior are reused.

The configured infrastructure reserve is 1,500 USD micros (0.0015 USD) per bounded operation; settlement reserve is currently zero, subject to facilitator terms. This is a conservative configured budget, not a measured invoice or a guarantee of future sponsored settlement. Assuming nominal USDC/USD parity for budgeting only, the initial estimated contributions are 0.0085 and 0.0185 per request. They exclude taxes, treasury conversion, fixed subscriptions and unknown actual costs. The existing minimum contribution gate rejects a price when its configured variable-cost budgets do not leave the required positive margin. Re-evaluate the budget against actual Workers/DO requests, reads, writes, storage and facilitator charges before increasing limits. Actual profit remains UNKNOWN without sufficiently complete invoices and revenue evidence.

Financial reservation, settlement, operation and reconciliation records remain durable. Redundant legacy per-stage journey objects are skipped for new Live services; compact funnel counters retain critical stages and structured logs retain failures. Public free-route telemetry and collector limits are not expanded. Rate limits, body/result bounds, a 60-second single-flight readiness cache and a paid-only circuit constrain additional work. Three delivery/dependency failures within five minutes pause new purchases for fifteen minutes; a response over 30 seconds logs a warning and contributes to that circuit. The circuit does not disable the free router or result recovery.

`GET /admin/paid-revenue` uses existing owner authentication and no-store. The current admin page links the new private view and can reset the paid circuit through the existing CSRF/origin-protected form. It separates external production attempts, verified authorizations, settlement events, deduplicated cash, signed deliveries, recognized revenue, unfulfilled liabilities, demand/revenue ranking and discovery-to-delivery ratio. Ratios describe attempts since instrumentation, not unique people. Synthetic/internal/self-payments are excluded. No observed financial rows means UNKNOWN, not a fabricated zero. Costs, net profit and Cloudflare payout due are UNKNOWN without their separate evidence. Legacy internal `usd_micros` cash fields denote nominal USDC atomic units; public totals identify the token explicitly.

The same private view reports bounded per-service HTTP status and origin-latency histograms, including P50/P95 bucket upper bounds. These do not measure client network latency or the free site's traffic. Existing Live metrics retain path/client counts, crawler classification, status counts and aggregate cache/data diagnostics; account-wide resource usage still requires the provider dashboard/diagnostic credential.

## Deployment, rollback and verification

1. Ship all supporting code with `LIVE_PAID_SERVICES=off` and `payment_state_version=3`. Verify the exact deployed tag, catalog and paused purchase response. No Durable Object binding or migration changes are made. This forward compatibility boundary cannot safely roll back to code that cannot reconcile the new input type.
2. In a separate config-only PR, set `LIVE_PAID_SERVICES=on` while retaining payment state version 3. New purchases still fail closed until data, financial storage and facilitator checks pass. The verified supporting release is the safe rollback target and still recovers prior payments with new purchases paused.
3. Never delete namespaces or lower the payment state version to force rollback. A support-release regression requires a compatible forward fix. Existing financial reconciliation alarms and historical recovery remain exported.

CI runs Live syntax/types, public and paid behavior, actual workerd/SQLite integration, existing financial regression checks, lifecycle guards and production bundle dry-run. The compatibility harness compares an independently built exact pre-change revision, 24 route/representation cases, cache policy/hits and 60 alternating warmed timing samples per build. The local P95 gate rejects a regression beyond the larger of 50% or 5 ms; this is a local test, not a real-traffic guarantee. Unit coverage additionally compares 28 public paths in HTML/Markdown/JSON and preserves the existing scheduled handler.

The production deploy and hourly monitor both run `scripts/live-paid-smoke.mjs`: read the catalog and make one unsigned synthetic request. It checks prices, contracts and deployed version without a wallet or spend. A 503 paused/not-ready condition is reported as purchase blocked, never as a sale. Unexpected paid contract failure causes compatible rollback, including when an unrelated public quota outage is also present. Known quota failure remains a failed public verification and retains the tested quota-recovery build. No paid plan is automatically enabled.

During deployment verification, the paid smoke waits for the expected API revision through at most six catalog probes, five-second individual deadlines and five-second propagation intervals. A revision that never converges, unexpected contract, unsigned result or non-JSON response still fails. Rollback verifies the restored build and paid contract explicitly. If the public quota was already exhausted, rollback reports that remaining public failure rather than retrying a known quota response with its long Retry-After; other health retries use a bounded loop. Four isolated smoke tests cover propagation, the unpaid challenge, absence of unsigned delivery, persistent version mismatch and unexpected errors.

Production compatibility and traffic impact remain incomplete while provider storage is exhausted. Pre-change single HTTP probes are an outage baseline, not sufficient samples for network P50/P95 or traffic attribution. Compare equal-duration, same-source post-reset windows before claiming stable requests, bot traffic, cache ratio or provider costs. A genuine independent production settlement followed by signed delivery is still required to prove a commercial sale.

## Primary protocol/provider references

- [x402 v2 HTTP exchange](https://docs.x402.org/core-concepts/http-402)
- [Exact payment scheme](https://docs.x402.org/schemes/exact)
- [Payment identifier extension](https://docs.x402.org/extensions/payment-identifier)
- [Service description discovery, RFC 8631](https://www.rfc-editor.org/rfc/rfc8631.html)
- [Durable Objects pricing and free limits](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Pay Per Crawl availability](https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/what-is-pay-per-crawl/)
- [Cloudflare payout onboarding](https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/use-pay-per-crawl-as-site-owner/manage-payouts/)
- [Pay Per Use beta](https://blog.cloudflare.com/pay-per-use/)
