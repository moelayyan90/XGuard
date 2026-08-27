# XGuard Edge Gate

Transparent x402 payment enforcement in front of an existing HTTPS backend.

```text
client / agent
      |
      v
XGuard Edge Gate (Cloudflare Worker)
      |  protected route: require x402 payment
      |  verify + settle through https://xguardgate.com/api
      v
existing origin API / website
```

The origin does not need the XGuard SDK or x402 middleware. Once the site owner routes traffic through this Worker, every configured protected request is stopped at the edge until the x402 payment succeeds.

## One-click deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/moelayyan90/XGuard/tree/main/apps/edge-gate)

Cloudflare clones the isolated `apps/edge-gate` Worker into the deployer's own Git repository and configures Workers Builds. Before using production funds, replace the sample `ORIGIN_URL`, `PAY_TO` and protected route rules; the runtime deliberately refuses the zero sample receiving address.

## OpenAPI AutoGate

If the existing backend already publishes OpenAPI, XGuard can derive the payment surface automatically instead of declaring every route twice.

```jsonc
{
  "AUTO_GATE_OPENAPI": "true",
  "OPENAPI_URL": "https://api.example.com/openapi.json",
  "DEFAULT_PRICE": "$0.01"
}
```

When AutoGate is enabled:

- every GET/POST/PUT/PATCH/DELETE/HEAD operation in the OpenAPI `paths` map is paid by default;
- `{pathParameters}` match exactly one URL segment;
- an operation can set `x-xguard-price` to override the default price;
- an operation or whole path can set `x-xguard-free: true` (or `x-xguard-paid: false`) to remain public;
- `OPENAPI_URL` must be HTTPS and on the same origin as `ORIGIN_URL`;
- the policy document is capped at 1 MiB and cached for five minutes;
- if AutoGate is enabled and its OpenAPI policy cannot be fetched or parsed, XGuard **fails closed with 503** rather than silently forwarding a potentially paid operation for free.

Example existing OpenAPI operation:

```yaml
/weather/{city}:
  get:
    summary: Weather by city
    x-xguard-price: "$0.003"
/public/status:
  get:
    x-xguard-free: true
```

Inspect the derived paid surface without exposing secrets:

```text
GET /__xguard/openapi
```

This means an API with dozens or hundreds of documented operations can be moved behind the payment gate with one explicit deployment setting rather than one middleware edit per endpoint.

## Production configuration

Edit `wrangler.jsonc` or set equivalent Worker variables:

- `ORIGIN_URL`: the existing HTTPS backend.
- `PAY_TO`: the merchant's non-zero EVM receiving address.
- `NETWORK`: CAIP-2 EVM network, normally `eip155:8453` for Base mainnet.
- `PROTECTED_PATTERNS`: optional explicit paid route rules; manual rules win over AutoGate.
- `AUTO_GATE_OPENAPI`: explicit opt-in for OpenAPI-derived protection.
- `OPENAPI_URL`: same-origin OpenAPI JSON URL; defaults to `<origin>/openapi.json` when AutoGate is on.
- `DEFAULT_PRICE`: default AutoGate price, normally `$0.01`.
- `FACILITATOR_URL`: defaults to `https://xguardgate.com/api`.
- `XGUARD_LICENSE_KEY`: optional Worker secret for XGuard Usage Credits after the free allowance.

Explicit route example:

```json
[
  {
    "method": "GET",
    "pattern": "/api/premium/*",
    "price": "$0.01",
    "description": "Premium API access"
  },
  {
    "method": "POST",
    "pattern": "/v1/inference/*",
    "price": "$0.05",
    "description": "Paid inference"
  }
]
```

Set the optional XGuard license without committing it:

```bash
npx wrangler secret put XGUARD_LICENSE_KEY
```

Deploy manually:

```bash
cd apps/edge-gate
npm install
npm test
npx wrangler deploy --minify
```

## Enforcement properties

- protected requests do not reach `ORIGIN_URL` until x402 middleware authorizes them;
- `/verify` and `/settle` use the XGuard facilitator control plane;
- successful origin responses carry `x-xguard-edge-gate: enforced`;
- invalid/zero `PAY_TO` fails closed with HTTP 500 rather than creating a bad payment requirement;
- `ORIGIN_URL` must use HTTPS and cannot embed credentials;
- route matching supports exact paths and `/*` prefix patterns without prefix-confusion matching;
- OpenAPI path templates match by segment, not loose prefix;
- the merchant's `payTo` and price are supplied by the deployer; XGuard does not silently rewrite either.

## Public diagnostics

- `GET /__xguard/health`
- `GET /__xguard/config`
- `GET /__xguard/openapi`

The diagnostic endpoints do not expose the XGuard license key.

## Why this is a stronger integration

Framework SDK integration requires application code changes. Edge Gate moves x402 enforcement to the HTTP routing layer. AutoGate moves route declaration to the API's existing OpenAPI contract. For an adopted deployment, the backend can remain unchanged and protected request paths necessarily traverse the XGuard-controlled verify/settle route before reaching the origin.
