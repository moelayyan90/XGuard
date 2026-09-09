# XGuard: public sources into usable results

Give an agent pages, product URLs or feeds. XGuard fetches bounded public sources,
selects working alternatives, parses and normalizes the output, removes duplicates,
and returns source evidence in one result.

Get your first result without an account, key, wallet or installation:

```bash
curl https://api.xguardgate.com/v1/execute \
  -H 'content-type: application/json' \
  -d '{"intent":"demo"}'
```

This runs the real extraction parser on labelled sample HTML. Supply `html` to process
up to 12 KiB of your own document for free. The preview makes no external requests.

| Outcome | Exact USDC price | Delivery |
| --- | ---: | --- |
| `extract-preview` | Free | Supplied HTML or labelled sample: text, metadata, offers and digests |
| `web-extraction` | 0.003 | Up to three pages, normalized evidence and duplicate groups |
| `product-offers` | 0.006 | Schema.org offers, identifier/currency grouping and provenance |
| `feed-digest` | 0.002 | RSS/Atom merge, backup sources, deduplication and chronology |

Prices are per bounded execution, including fallback. Read the live
[capability index](https://api.xguardgate.com/v1/capabilities) for current availability,
exact prices, limits, schemas and examples. There is no web-wide search, browser
rendering, OCR or general AI model. Supplied merchant data is not independently verified.

## One paid call from an agent

Send a supported intent directly, for example
`{"intent":"Get a technology news digest","limit":10}`.
The first HTTP request returns 402, the exact price, delivery description,
`Payment-Required` and an input-bound `X-XGuard-Quote`. A funded x402 v2 client signs
and retries the identical body. XGuard verifies and settles before source access.

The repository includes an automatic helper:

```js
import { createXGuardOutcomeClient } from './sdk/outcomes.js';

// payer is your configured x402Client with a caller-owned, funded signer.
const xguard = createXGuardOutcomeClient({ payer, maxAmountAtomic: '2000' });
const output = await xguard.execute({ intent: 'Get a technology news digest' });
console.log(output.result);
// Keep output.recovery private; use it if delivery needs to be retrieved later.
const same = await xguard.getResult(output.recovery);
```

One logical `execute` call uses two XGuard HTTP requests for paid work. It refuses
payments outside the explicit budget, network or USDC asset. It never creates a new
payment to recover an uncertain response. A wallet is required for paid work; installing
MCP alone does not provide one. This helper ships in this repository; no new npm release
is claimed. See [the runnable paid example](sdk/examples/outcome-paid.mjs).

If all sources fail after settlement, the response carries an execution credit bound
to the same outcome. Retry with `X-XGuard-Credit` and the signed quote; no second payment
is required. Credit fulfillment is stored and recoverable using the original quote.
A credit is not an automatic cash refund. Read-only recovery continues to accept the
original quote after its execution expiry; treat that quote as a private bearer token.

## JavaScript, Python, MCP and A2A

```js
const response = await fetch('https://api.xguardgate.com/v1/execute', {
  method: 'POST', headers: {'content-type': 'application/json'},
  body: JSON.stringify({intent: 'demo'})
});
console.log(await response.json());
```

```python
import requests
print(requests.post('https://api.xguardgate.com/v1/execute',
                    json={'intent': 'demo'}, timeout=15).json())
```

The [MCP endpoint](https://api.xguardgate.com/mcp) lists only `xguard_discover`,
`xguard_execute` and `xguard_get_result`. Call `xguard_execute` with `{"intent":"demo"}`.
[Editor configurations](https://xguardgate.com/developers) are ready to copy.

For [A2A](https://api.xguardgate.com/.well-known/agent-card.json), use `SendMessage`
with one user part: `{"text":"demo"}` or `{"data":{"intent":"demo"}}`.
The same four executable outcomes are the advertised skills.

[Agent instructions](https://api.xguardgate.com/agent.txt) explain discovery, execution,
402 retry, recovery and errors. [OpenAPI](https://api.xguardgate.com/openapi.json) starts
with `POST /v1/execute`. Malformed or unsupported intents return `repair.suggested_request`.
English/Arabic intent matching is bounded; arbitrary natural-language jobs are not promised.

## Evidence, limits and compatibility

A successful response has `ok`, `intent`, `capability`, `result`, `verification`, `cost`
and `receipt`. Paid receipts and digests establish execution/content integrity, not the
truth of a page or a merchant's actual checkout price. Partial source coverage is explicit.
Caches require origin permission and caller allowance; product offers always use fresh reads.

HTTPS/443, public-DNS/private-IP checks, manual redirects, bounded decompressed bodies,
credential isolation, payment binding, replay protection and durable state remain enforced.
The current Cloudflare fetch transport does not pin the connection to the DNS-checked IP;
complete DNS-rebinding prevention remains a transport limitation.

Existing credential-backed actions and operator credits remain supported at
[operator pricing](https://xguardgate.com/pricing/operator). The old gateway quickstart is
[archived](docs/legacy-gateway-quickstart.md); [durable delegated actions](docs/secretless-outcomes.md)
and existing SDK imports remain compatible. Reusable vendor credentials are never required
for the public-source outcomes.

## Verification and commercial evidence

Run `npm ci --prefix apps/relay` and
`node --test apps/relay/src/outcome-http-test.js` for real HTTP-socket flows with controlled
source/facilitator fixtures and actual quote/proof cryptography. Mock settlement is not
an on-chain payment. `node scripts/verify-production-identity.mjs` verifies public free
execution and signed paid challenges without spending funds.

Read [the audit](PRODUCT_REFOUNDATION.md), [capability selection](HIGH_VALUE_CAPABILITIES.md),
[distribution work](DISTRIBUTION.md) and [release verification](REFOUNDATION_VERIFICATION.md).
The [metrics endpoint](https://api.xguardgate.com/v1/metrics) distinguishes external
production settlement, recognized delivery, liabilities and synthetic tests. Event ratios
are not user cohorts; actual infrastructure costs and gross margin remain unknown.
Working outcomes and successful deployment do not establish customer demand or adoption.
