# XGuard paid API gateway

Turn an existing HTTPS API into a priced endpoint at
`https://api.xguardgate.com/p/{seller}/{service}/{path}`.
Buyers need an owner-authorized funded Base USDC wallet, not an XGuard account.
Sellers use [the seller workspace](https://xguardgate.com/sellers).

## Register and publish

1. `POST /v1/sellers` with `{"name":"Your API business"}`. Save the returned
   `xgs_…` token privately; it is shown once and only its hash is stored.
2. `POST /v1/sellers/services`, with `Authorization: Bearer <seller token>`:

```json
{
  "service_name": "My API",
  "description": "What the buyer actually receives",
  "upstream_base_url": "https://your-api.example/v1/data",
  "allowed_methods": ["GET", "POST"],
  "price_atomic": "100000",
  "route_pricing": [{"method":"POST","path":"/batch","price_atomic":"500000"}],
  "payout_destination": "0xYourBaseWallet",
  "max_requests_per_minute": 60,
  "upstream_auth": {"header":"authorization","prefix":"Bearer ","secret":"YOUR_PRIVATE_UPSTREAM_KEY"}
}
```

Omit `upstream_auth` for a public API. Secret values are encrypted using the
existing EgressKeyAuthority envelope scheme and are absent from public metadata,
receipts and logs. A secret echoed by an upstream response is blocked.
Only publish APIs you control or have permission to distribute.

The response includes the paid endpoint, exact allocation, curl command and
activation status. A service stays **draft** if its payout signer or economics
are not ready. `POST /v1/sellers/services/{service_id}/status` accepts `active`,
`paused` or `draft`; activation rechecks the financial prerequisites.
Services and fee policies are immutable snapshots: create a replacement service
and pause the old service to change its upstream, price, payout destination or fee.

The paid URL ending `/` maps to the exact registered endpoint, preserving its
trailing-slash choice. Additional paths append beneath the registered path;
query strings pass through. Methods, path, body, selected content headers,
price, payout and fee policy are all bound into the signed quote.
Writes require an 8–128 character `Idempotency-Key`. Reusing that key for another
authorization or payload is rejected before a second settlement.
Limits: 16 KiB request, 48 KiB response, 12 second upstream timeout, 20 services
per seller and 20 exact method/path prices per service. The configured service
request limit is per connecting IP per minute; the paid gateway also applies
its global per-IP limit. Streaming, redirects, WebSockets and arbitrary forwarded
buyer headers are unsupported. Upstream hosts must resolve publicly; private,
metadata and XGuard-owned destinations and path escapes are blocked.

## Buyer flow

1. Call the paid URL. The response is HTTP 402, `Payment-Required` and
   `X-XGuard-Quote`. The upstream has not executed.
2. Approve the exact asset, chain and maximum amount in the payer's spending
   policy. Use the official x402 signer through `sdk/paid-api.js`.
3. Retry the identical request with the quote and `Payment-Signature`.
4. Receive the upstream bytes plus `Payment-Response`, `X-XGuard-Receipt`,
   `X-XGuard-Proof`, `X-XGuard-Accounting-Status` and fee/proceeds headers.
   The signed proof binds the response digest to the transaction and allocation.

The public useful demo is `GET /p/xguard/feed-digest/?limit=10`; it reuses the
existing RSS/Atom normalization, deduplication and source-attribution engine.
It is priced at 100000 atomic units (0.10 USDC) by default. Price inspection is
free. The separate legacy `/v1/execute` feed product retains its existing price;
this demo demonstrates the new fee ledger, not an exclusive data source.

Install the payer dependencies (`@x402/core@2.24.0`, `@x402/evm@2.24.0`, `viem`)
in the project running the example, then run:

```sh
node sdk/examples/paid-api-buy.mjs
# An operator-controlled test; provide a funded payer key securely in the environment.
node sdk/examples/paid-api-buy.mjs --pay --max-amount-atomic 100000 --synthetic
node sdk/examples/paid-api-buy.mjs --recover PRIVATE_RECOVERY_FILE
```

The helper never signs without `--pay`, an explicit cap and a supplied key.
It saves private recovery data before submitting the authorization.
`GET /v1/marketplace/results/{payment_identifier}`, with the original
`X-XGuard-Quote`, recovers stored bytes without a new charge, even after the quote
has expired. Recovery does not execute the upstream. After an uncertain write,
keep the original key and recover its status; do not start a new purchase.

## Fees, seller proceeds and payout authority

| Setting | Default | Meaning |
|---|---:|---|
| `XGUARD_PLATFORM_FEE_BPS` | `300` | Percentage in basis points: 300 = 3% |
| `XGUARD_FIXED_FEE_ATOMIC` | `0` | Added fixed fee in USDC atomic units |
| `XGUARD_MINIMUM_FEE` | `0` | Minimum total fee in atomic units |
| `XGUARD_SELLER_FEE_OVERRIDES` | `{}` | Seller ID → `bps`, `fixed_atomic`, `minimum_atomic` |
| `XGUARD_PAYOUT_MAX_ATOMIC` | `1000000` | Maximum seller payout per request |
| `XGUARD_MARKETPLACE_DEMO_PRICE_ATOMIC` | `100000` | First-party gateway demo price |

Fee = max(minimum, ceil(price × bps / 10000) + fixed). Seller proceeds are price
minus fee. Quotes are refused when the fee cannot cover configured cost budgets
and minimum contribution. These are budgets, not measured profit.

Standard exact x402 has one `payTo` per accepted payment requirement; it is not
an automatic marketplace split. The existing treasury receives the buyer payment.
After signed delivery the ledger records the fee and seller receivable. An
independent Durable Object reserves one seller payout, signs an exact USDC
authorization, submits it to the existing facilitator and confirms matching
AuthorizationUsed **and** Transfer evidence through read-only Base RPC.

The operator must configure `XGUARD_PAYOUT_PRIVATE_KEY` securely in the existing
Worker's secret settings. It must control `XGUARD_TREASURY_USDC_ADDRESS`; mismatched
or absent authority blocks external seller activation. Never put it in Git,
browser forms, chat or receipts. The key is not generated by the product.
For production key-custody policy, replace this secret-backed signer with an
approved remote signer before enabling sellers if an exportable key is unsuitable.

An ambiguous payout is never resubmitted. Its persisted nonce is reconciled
without another money transfer. Rejected, configuration-blocked or exhausted
recovery records remain visible for operator review. A same-wallet first-party
service records `same_owner_retained`; it does **not** fabricate a seller transfer.
Seller payout is asynchronous; a successful buyer response is not a promise
that the separate transfer has already finalized.

Failed or ambiguous upstream execution after settlement retains the whole buyer
amount as an unfulfilled liability. It earns no platform fee and creates no
seller payout. The operation requires review; there is no blind write replay,
automatic refund signing or false claim that a refund was sent.

## Revenue evidence

`GET /v1/sellers/dashboard` is seller-token protected. `GET
/internal/revenue-funnel` requires the independent server-configured
`XGUARD_OPERATOR_METRICS_KEY` bearer credential. The monitor uses a matching
GitHub Actions secret if supplied. Missing access means **unknown** revenue,
not zero revenue.

REAL, SYNTHETIC, INTERNAL, CRAWLER, REGISTRY and MONITORING have separate ledgers.
Configured internal wallets, the treasury and each seller's own payout wallet
are excluded from REAL. Declare operator tests `synthetic`; add other owned
wallets to `XGUARD_INTERNAL_WALLETS`. A wallet's economic ownership cannot be
inferred reliably from an address alone.

REAL gross volume counts unique confirmed buyer settlements. REAL paid
transactions and XGuard fee revenue require successful signed delivery.
SELLER_PAYOUTS counts separate chain-confirmed transfers only. Same-owner
retention, unpaid seller receivables and unfulfilled buyer funds stay separate.
Fee and payout outboxes are idempotent. `recorded` means the fee-ledger write
was acknowledged; `pending` means durable reconciliation is still needed.

The funnel includes every requested stage. Event counts describe request
attempts, not unique customers. Conversion ratios use those denominators and
can include repeat requests. The first ledger observation starts a new period;
historical revenue is not invented or silently backfilled.

The hourly and post-deployment monitor checks catalog, price allocation and
access protection without signing, paying or calling the upstream. Its report
explicitly says `paid_transaction_proven: false`. It is not customer revenue.

## Acceptance gate

Unit tests and workerd integration fixtures prove code paths with controlled
facilitator and RPC responses. They cannot prove a real payment. Production
acceptance requires one actual owner-authorized funded request, confirmed
settlement, useful result, valid receipt, recorded fee and seller receivable.
Until those are observed, the six production payment checks must remain FAIL /
not proven; do not describe this revenue system as finished or guaranteed income.

Primary protocol references: [x402 flow](https://docs.cdp.coinbase.com/x402/how-it-works)
and [seller facilitator contract](https://docs.cdp.coinbase.com/x402/seller/facilitator).
