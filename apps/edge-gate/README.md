# XGuard Edge Gate

Transparent x402 payment enforcement in front of an existing HTTPS backend.

```text
client / agent
      |
      v
XGuard Edge Gate (Cloudflare Worker)
      |  protected route: require x402 payment
      |  verify + settle through https://api.xguardgate.com
      v
existing origin API / website
```

The origin does not need the XGuard SDK or x402 middleware. Once the site owner routes traffic through this Worker, every configured protected request is stopped at the edge until the x402 payment succeeds.

## One-click deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/moelayyan90/XGuard/tree/main/apps/edge-gate)

Cloudflare clones the isolated `apps/edge-gate` Worker into the deployer's own Git repository and configures Workers Builds. Before using production funds, replace the sample `ORIGIN_URL`, `PAY_TO` and protected route rules; the runtime deliberately refuses the zero sample receiving address.

## Production configuration

Edit `wrangler.jsonc` or set equivalent Worker variables:

- `ORIGIN_URL`: the existing HTTPS backend.
- `PAY_TO`: the merchant's non-zero EVM receiving address.
- `NETWORK`: CAIP-2 EVM network, normally `eip155:8453` for Base mainnet.
- `PROTECTED_PATTERNS`: array of paid route rules.
- `FACILITATOR_URL`: defaults to `https://api.xguardgate.com`.
- `XGUARD_LICENSE_KEY`: optional Worker secret for XGuard Usage Credits after the free allowance.

Example:

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
- the merchant's `payTo` and price are supplied by the deployer; XGuard does not silently rewrite either.

## Public diagnostics

- `GET /__xguard/health`
- `GET /__xguard/config`

The config endpoint does not expose the XGuard license key.

## Why this is a stronger integration

Framework SDK integration requires application code changes. Edge Gate moves x402 enforcement to the HTTP routing layer. For an adopted deployment, the backend can remain unchanged and the protected request path necessarily traverses the XGuard-controlled verify/settle route before reaching the origin.
