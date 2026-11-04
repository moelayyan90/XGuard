# XGuard Settlement Gateway

This is a separate Worker for the XGuard Live source revision
`fd9db99ddefce5c24b161c0f8436cbe30d4239c3`. All runtime logic is in
`xguard-gateway.ts`. It is a deployment candidate validated in workerd with
local dependency fixtures. No production deployment, external checkout,
mainnet transfer, DNS change, or traffic migration was performed.

## Request lifecycle

1. The Worker checks the exact host, GET method, allowed path, and request
   bounds. It does not infer authority from User-Agent, a bot label, or an
   upstream success code. Exactly one credential must be present.
2. **Base USDC:** The gateway checks the x402 v2 exact challenge, 65-byte EOA
   EIP-712 signature, chain, USDC, payer, recipient, amount, and authorization
   lifetime. The buyer authorizes one transfer of 1,000 atomic USDC
   (0.001 USDC). The worker does not sign on behalf of the buyer or hold a
   private key. An authorization by the merchant to itself is rejected.
3. **Credits:** The gateway checks its own signed bearer capability. The
   wallet and merchant identify a SQLite Durable Object/account; the
   ledger atomically holds 1,000 USD microcredits before any origin call.
4. A read-only result is prepared privately through a Worker service binding.
   This step follows authorization verification and a durable reservation.
   It never grants access by itself. The origin must produce HTTP 200 with
   valid JSON within 64 KiB. Errors and redirects do not incur a committed
   credit debit or trigger settlement.
5. For Base, only a durable journal transition permits one xpay `/settle`
   submission. A separate Base RPC read verifies a canonical successful
   receipt and the ordered USDC `AuthorizationUsed` and `Transfer` logs
   for the same payer, nonce, recipient and amount. It checks the configured
   L2 confirmation depth (12 by default). This is **not Ethereum L1 finality**.
   For credits, the result and consumption of the held balance commit
   together.
6. Only the completed transition unlocks the JSON and the settlement header
   where applicable. Responses are private and no-store. No credential,
   upstream error body, upstream Set-Cookie, or raw facilitator response is
   forwarded.

The fee is the sale price of the read, not an extra deduction from a
third-party merchant's transfer. Settlement proves that a payment happened,
not that a source assertion is true. Existing XGuard freshness/evidence
labels are preserved; the gate does not convert STALE into VERIFIED.

## Durable Object invariants

- Namespace key: `wallet:base-usdc:v1:<lowercase Base wallet>`. The same
  wallet does not fan out into independent replay authorities by merchant.
  Within its shard, `(wallet,merchant)` is indexed, and
  `(merchant,rail,account,idem)` is unique. The Base nonce key is independent
  of merchant, so a reused wallet nonce cannot be claimed for another entity.
- Only atomic synchronous SQL changes a lease, hold, or settlement state.
  No network operation runs inside a transaction. Ownership fences prevent
  late workers from committing after another request takes over.
- Base authorizations are signed for the transfer, **not for an HTTP URL**.
  XGuard binds the first accepted use durably to the merchant, URL, amount,
  nonce and idempotency key. Clients must send the proof only over TLS to the
  intended gateway and retain it privately. Use a dedicated payee/merchant
  identity if another service offers the same transfer terms.
- Preserve the original credential, URL and `Idempotency-Key` on retry.
  A completed matching retry returns the stored result without a second
  charge or origin call. Conflicting reuse returns 409. An ambiguous
  settlement returns 503 with Retry-After; do not sign a new authorization.
- After a lost settle response the gateway looks up the authorization nonce
  on Base. It never blindly resubmits. A failure between journaling and
  sending can therefore leave an unresolved attempt; reconcile that attempt
  before allowing another purchase. A read-only Base RPC with
  `eth_getTransactionReceipt`, `eth_getBlockByNumber` and bounded
  `eth_getLogs` support is necessary. The recovery range is up to 1,024
  blocks from the pre-submission anchor.
- Exact result recovery lasts one hour from initial reservation. Afterwards
  financial journal/tombstones remain. The bounded indexed sweep deletes at
  most eight expired result rows per claim and releases any expired credit
  hold atomically. Dormant shards do not self-purge. After a crashed credit
  request, retry the same job after its lease expires; an abandoned hold is
  released during expiry cleanup on later wallet activity. Arrange a
  retention and reconciliation process before a public rollout.
- Funding idempotency uses a separate canonical provider/payment-ID shard.
  Retrying the same grant after either durable commit is safe; remapping it
  to a different wallet, merchant or amount is rejected.

The cache is bounded RAM for recent completed retries. Cold starts and
eviction do not erase replay or billing state. Sharding avoids a global
hot object but one wallet still serializes its updates. There is no
global latency claim: the requested <5 ms is a target to measure for the
atomic check, not a verified production SLA. RPC, queues, cold starts,
SQLite writes, xpay's published rate limits and Base confirmation time are
distinct costs. Cloudflare Free quotas are account-wide; this design does
not increase them. Check xpay's current limits and terms before enabling
real settlement.

## Routes and client contract

The paid allowlist is GET `/fact/...`, `/live/...` (including supported
package identifiers), `/history/...`, `/changes[/...]`, `/evidence/...`,
`/topics[/...]`, `/healthz` and `/status`. The only optional query is
`?format=json`. Slash and path segments are checked; arbitrary destinations,
admin, legacy paid POSTs, sitemaps, and unsupported paths never reach the
origin. This prevents accidental double billing through the previous
paid endpoints. It does not turn the old homepage into a public free mirror.

Example discovery request (no payment proof is sent):

```sh
curl -i 'https://xguardgate.com/fact/npm/react/latest-version' \
  -H 'Idempotency-Key: my-fact-order-001'
```

On a configured gateway this returns 402 and a base64 JSON
`Payment-Required` x402 challenge. Use a compatible buyer to sign the
provided EIP-3009 requirement and repeat the same GET and idempotency key
with `Payment-Signature`. A credit client instead sends
`Authorization: Bearer <issued XGuard capability>`.
The 402 response does not indicate a sale or available balance. Missing or
invalid proof is 402; dependency failure and ambiguous settlement are
fail-closed 503; invalid origin result is 502. Do not count cached 200
deliveries or authorization challenges as payments. If present,
`Payment-Response` contains the verified Base transaction hash. The
`X-XGuard-Replayed` header distinguishes result recovery from the first
successful delivery.

## Test and build without deployment

Use Node 24. The runtime has one package dependency (viem); Wrangler and
Miniflare are development tools.

```sh
npm ci
npm run check
WRANGLER_SEND_METRICS=false npm test
```

The build is `wrangler deploy --dry-run`, with no production route.
Tests use workerd, real SQLite Durable Object transactions and offline
signed fixtures; the origin, xpay and Base RPC are simulated. The suite
tests unpaid and malformed requests, signature/amount and facilitator
rejection, 48-way replay contention, persisted recovery after restart,
lost settlement response, wrong chain and incorrect/reorganized logs,
upstream errors, grant replay, and credit contention/release.
No simulated transfer is evidence of commercial demand.

## Wrangler bindings and private origin cutover

The supplied `wrangler.jsonc` has `GATEWAY_ENABLED=false`, no routes,
`workers_dev=false` and `preview_urls=false`. It creates a new SQLite
`XGuardState` class, rather than migrating or resetting old financial
storage. Preserve the old Worker names, stored records, and existing
migration history.

- `PUBLIC_ORIGIN`: exact HTTPS origin of this gateway, without a trailing slash.
  Use a separate controlled staging hostname and separate state for staging.
- `MERCHANT_ID`: stable operator-assigned entity identifier. Do not accept it
  from an untrusted request header.
- `PAY_TO`: existing published XGuard receiving address in the sample; verify
  it independently and verify control before accepting funds. Do not change
  it while outstanding authorizations are being reconciled.
- `BASE_RPC_URL`: HTTPS endpoint for Base Mainnet (8453). Set with
  `npx wrangler secret put BASE_RPC_URL` on the designated Worker.
- `XPAY_AUTHORIZATION`: optional full authorization value, if the xpay
  integration explicitly requires it. Never forward a caller's token.
- `WEB2_TOKEN_SECRET`: optional unpadded base64url encoding of at least 32
  random bytes, stored as a secret. Without it the credit rail is disabled.
- `XGUARD_ORIGIN`: HTTP service binding to `xguard-mainnet`. Verify the live
  origin binding with the exact deployed origin version before routing.
  Origin fetches use a new request and an internal hostname; no public
  proxy URL or caller credential is passed.
- `GATEWAY_LIMIT`: simple per-IP Workers rate limit. This is a local
  protection, not a global spend or xpay rate limit.
- `GATEWAY_TELEMETRY`: optional Analytics Engine binding. Set the dataset in
  Wrangler to collect route group, rail, status, elapsed time and replay bit.
  It records no wallet, full URL or proof, and is not the financial ledger.

Deploying the gateway without isolating the origin **does not make the
gateway mandatory**. An approved production cutover must remove direct
data-serving public routes/custom domains from the origin, disable
workers.dev and preview URLs there, and eliminate or gate every alternate
cache, mirror, API alias, metadata feed, or other Worker that can return
the same data. A static marketing page may be separate; a data-bearing
HTML page would still be a bypass. Move private administration and
historical purchase recovery behind a separate authenticated control
surface; do not discard old obligations. Verify no bypass on apex, www,
API and any old preview/alias, purge public cached data where needed,
then attach the approved gateway hostname and enable it. Only use
`npx wrangler deploy` after those routing and staging checks. Preserve the
same financial namespace on rollback; restoring stale ledger snapshots
can resurrect spent balances or idempotency keys.

## Stripe/Lemon Squeezy integration boundary

No Stripe key, Lemon Squeezy key, card processor account, webhook, or payout
is connected by this file. The credit ledger and capability verification
are implemented. Bind a separate trusted billing Worker to the named
RPC entrypoint; do not expose an unsigned funding/mint endpoint:

```json
{
  "services": [
    {
      "binding": "XGUARD_CREDITS",
      "service": "xguard-settlement-gateway",
      "entrypoint": "XGuardCredits"
    }
  ]
}
```

Your billing Worker verifies the provider webhook with that provider's
current signature rules, confirms a captured/paid USD payment, resolves
the merchant/account/wallet from its own records, and then calls
`XGUARD_CREDITS.credit({wallet, merchant, account, provider, paymentId,
amount})`. For Stripe, use the canonical paid PaymentIntent ID; for
Lemon Squeezy, use the canonical paid order ID. `amount` is integer USD
microcredits (one USD cent is 10,000 microcredits); apply your verified
pricing and refund policy before granting a balance. This trust boundary
does not permit caller-supplied "paid" flags or provider secret keys as
client credentials. Handle reversals before production onboarding.

An authenticated control plane calls
`XGUARD_CREDITS.issueToken({wallet,merchant,account})` for its own mapped
account. The capability is bound to this gateway's origin and expires in
15 minutes. Token rotation does not change the identity, balance or
idempotency scope. The billing Worker must never mint a capability on the
strength of an arbitrary wallet address supplied by an unauthenticated
caller.

## Primary references

- Cloudflare SQLite storage and synchronous transactions:
  https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- Cloudflare service bindings:
  https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
- Cloudflare Durable Objects usage limits/pricing:
  https://developers.cloudflare.com/durable-objects/platform/pricing/
- x402 exact EVM:
  https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md
- xpay facilitator:
  https://docs.xpay.sh/en/x402-protocol/facilitator
- Circle official USDC deployment addresses:
  https://developers.circle.com/stablecoins/usdc-contract-addresses
- Circle authorization event order:
  https://github.com/circlefin/stablecoin-evm/blob/master/contracts/v2/EIP3009.sol


## Hosted staging

The dedicated staging branch runs `.github/workflows/settlement-staging.yml`
using the repository's existing Cloudflare deployment credentials. It
deploys `xguard-settlement-gateway-staging` with its own state on the
account's existing workers.dev subdomain and a randomly rotated probe key.
It neither attaches custom domains nor modifies `xguard-mainnet`.
The entrypoint denies every unauthenticated request and exposes no fact,
only check results to the authenticated probe. The probe runs the real
gateway against the existing Live Worker via Service Binding. The credit
is synthetic and isolated; Base RPC is deliberately unavailable in this
deployment. The stage therefore proves source binding, authorization,
metering, and replay behavior, with no transfer or payment provider
charge. The production configuration remains separate and disabled.

## Production cutover: mandatory paid validation, free discovery preserved

The current production config publishes the gateway only through the
xguard-mainnet Service Binding. Paid reads live under
/api/gateway/v1; canonical public facts, HTML, Markdown, crawler discovery,
sitemaps and the existing paid product endpoints stay on the original router.
The paid route never falls back to free output if the gateway or billing fails.
The /catalog response is public service metadata only. The paid validation
returns the verified observation and a body hash together with the appropriate
payment receipt. This does not make an independent factual assertion beyond the
source evidence or promise verified latency.

The existing Lemon Squeezy 0.3.0 Worker is bound privately. It validates a
customer's existing non-test, non-revoked license, and debits one existing
license credit using its atomic /v1/assure operation. The gateway stores a
result-bound intent before calling it. The provider's replay response is
accepted only when its assurance ID matches the exact fingerprint. The
gateway deliberately never calls the legacy non-idempotent /v1/consume.
No webhook configuration or provider ledger is replaced. The catalog directs
buyers to https://credits.xguardgate.com/, the existing XGuard purchase page
linked to the published Lemon Squeezy **XGuard Usage Credits** product. Use the
resulting license as the Bearer credential. Lemon Squeezy issues the purchase
invoice; `X-XGuard-Billing-Receipt` records an individual use of a credit, not
a second invoice. Merely opening checkout does not verify payment, invoice
issuance or webhook delivery for a new purchase.

Customers can open https://xguardgate.com/api/gateway/v1/checkout from the
home page or a verified fact page. They choose one license credit or a
0.001 USDC payment on Base and download the verification receipt after payment.
No wallet private key is sent to XGuard. The page retries the same order across
ambiguous responses and displays the Base transaction only after confirmation.
The old test page redirects to checkout. The deployment workflow verifies
the public gate, checkout links and billing denial without moving funds.
