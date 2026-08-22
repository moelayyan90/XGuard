# Deployment

Production is deployed by `.github/workflows/global-commerce-mainnet.yml` to the existing `xguard-mainnet` Worker, `xguard-mainnet` D1 database, and `xguardgate.com` custom domains.

## Required GitHub secrets

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The workflow applies migrations and deploys without requiring inference credentials. This produces a truthful `NOT LIVE` public control plane when no model is configured.

## Required Cloudflare secrets for inference

```text
DGRID_PROVIDER_API_KEY
XGUARD_ADMIN_TOKEN
XGUARD_UPSTREAM_1_API_KEY
```

Optional:

```text
XGUARD_PAYOUT_DESTINATION
XGUARD_UPSTREAM_2_API_KEY
XGUARD_UPSTREAM_3_API_KEY
```

Configure the matching non-secret upstream variables only after the commercial review in [PROVIDERS.md](PROVIDERS.md). Do not put secret values in Wrangler configuration.

Routes also remain blocked until `XGUARD_NETWORK_FEE_PERCENT` and `XGUARD_VARIABLE_INFRA_MICRO_USD_PER_REQUEST` contain verified non-negative values from the network contract and measured infrastructure economics.

## Release gates

```bash
npm ci --ignore-scripts
npm run inference:verify
npx wrangler d1 migrations apply xguard-mainnet --remote \
  --config apps/worker/wrangler.mainnet.resolved.jsonc
npx wrangler deploy --config apps/worker/wrangler.mainnet.resolved.jsonc
```

Post-deploy verification checks service identity, OpenAPI, D1-backed status, public model truth, custom domains, and the owner endpoint's authentication boundary. A real inference smoke call runs only when the runner has the same network credential and at least one active model; it never falls back to a mock.
