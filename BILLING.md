# Billing

## Model

XGuard uses a prepaid merchant service balance. It does not silently divert money from a merchant's advertised payment. Service fees are separately accounted for and deducted from the merchant's prepaid XGuard balance.

Production prices are configured in `apps/worker/wrangler.mainnet.jsonc`. The public x402 payment contract is centralized in `apps/worker/src/public-payment-contract.ts` so the runtime and public manifests share one canonical price and billing event.

Current mainnet execution prices include:

| Event                                        |     Fee |
| -------------------------------------------- | ------: |
| Model proxy execution                        | $0.0001 |
| Tool proxy execution                         | $0.0002 |
| Source discovery/search                      | $0.0010 |
| Security inspection                          | $0.0010 |
| Analysis/ranking                             | $0.0020 |
| Payment-decision execution                   | $0.0010 |
| Accepted authenticated x402 economic attempt | $0.0300 |

Merchant top-ups are prepaid service liabilities; they are not revenue when deposited.

## Free surface

Readiness and protocol metadata remain free, including:

- `GET /healthz`
- `GET /readyz`
- `GET /supported`
- well-known discovery documents
- MCP `server/discover`
- MCP `tools/list`
- MCP `ping`
- MCP `xguard_status`
- malformed or unauthenticated x402 traffic rejected before attempt acceptance
- idempotent retries for a `logicalPaymentKey` whose fixed x402 attempt fee has already been earned

Free discovery **metadata** must not be confused with value-producing discovery/search operations.

## Billable surface

Value-producing operations are billed according to their execution class. Examples include:

- `GET /discovery/resources`
- `GET /discovery/search`
- `POST /v1/gateway/proxy/...`
- `POST /v1/gateway/sources/search`
- `POST /v1/gateway/analyze`
- `POST /v1/gateway/security/inspect`
- payment-decision execution
- MCP `tools/call` except explicitly free metadata/status tools
- accepted authenticated x402 `/verify` or `/settle` execution

Direct Bazaar catalog listing/search and MCP `xguard_discover` / `xguard_resource_details` are SOURCE operations. This prevents bypassing SOURCE billing through an equivalent HTTP or MCP route.

## x402 attempt accounting

The public x402 path uses a fixed **$0.03 / 30,000 micro-USD non-refundable attempt fee**.

The sequence is:

1. authenticate the merchant scope;
2. parse and normalize the supported x402 request;
3. derive the canonical `logicalPaymentKey`;
4. reserve the fixed attempt fee from prepaid balance;
5. earn that fee before downstream execution; and
6. execute verification or settlement.

Because earning happens before downstream execution, a downstream verification or settlement failure does **not** refund an already accepted x402 attempt.

The fee is deduplicated by `logicalPaymentKey`. Verify → settle and repeated requests for the same logical payment do not create a second fixed attempt fee.

## Other execution accounting

Gateway, source, MCP, model, tool, analysis, security, and payment-decision operations retain their own configured fee classes and accounting rules. They must not be described as if they were the fixed x402 attempt fee.

## Mainnet implementation

The live Cloudflare Worker maintains merchant billing state in D1 and coordinates settlement ownership with Durable Objects.

Authenticated merchant endpoints include:

- `POST /v1/register`
- `GET /v1/balance`
- `POST /v1/topups/intents`
- `POST /v1/topups/claim`

A top-up intent returns an exact native Base USDC amount and the configured XGuard treasury address. The merchant sends that exact amount, then claims the deposit using the transaction hash and one-time claim token. XGuard independently verifies the finalized Base USDC transfer before crediting the service balance.

No simulated credit is accepted as a production top-up.

## Billing invariants

- No billable execution runs when the prepaid service balance cannot cover its configured fee.
- The canonical public x402 attempt price is $0.03 / 30,000 micro-USD.
- The x402 attempt fee is earned only after authentication, parsing, identity derivation, and successful reservation.
- A downstream x402 failure does not refund an already accepted attempt.
- One `logicalPaymentKey` creates at most one fixed x402 attempt fee.
- Equivalent direct HTTP and MCP catalog access cannot bypass SOURCE billing.
- Merchant top-up deposits are not counted as XGuard revenue.
- Testnet traffic remains non-billable unless explicitly changed in testnet configuration.
- Usage history is immutable; corrections use compensating accounting entries rather than destructive edits.

## Insufficient balance

A billable request without enough available service balance fails closed with HTTP `402` and `xguard_service_balance_required` / `insufficient_service_balance` semantics. The response identifies the required fee and the top-up path when available.

Requests without a valid merchant credential fail authentication before value-producing execution. The protected operation is not intentionally executed downstream when authentication or reservation fails.

## Settlement ambiguity and reconciliation

Settlement safety remains separate from the attempt-fee accounting event. Once an outbound blockchain settlement submission has started, XGuard does not blindly retry through another route. Network timeouts or uncertain downstream outcomes enter the settlement recovery/finality flow so duplicate money movement is not created.

## Auto-top-up

XGuard does not infer or charge a merchant funding instrument automatically. Any future auto-top-up mechanism must require explicit merchant authorization, funding limits, and a separately auditable provider integration.
