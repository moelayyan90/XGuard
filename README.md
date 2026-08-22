# XGuard Autonomous AI Inference Provider

XGuard is a production-oriented, profit-protected AI inference provider built on Cloudflare Workers, Durable Objects, Cron Triggers, and D1. Its first network target is [DGrid Model Marketplace](https://dgrid.ai/marketplace).

Production URL: [https://xguardgate.com](https://xguardgate.com)  
Repository: [https://github.com/moelayyan90/XGuard](https://github.com/moelayyan90/XGuard)

## Truthful current state

The software is deployable, but inference is deliberately **not live** until all activation gates pass:

1. an upstream endpoint and credential exist;
2. resale authority or self-hosted compute authority is documented;
3. input and output costs are configured in integer micro-USD;
4. network fees and per-request variable infrastructure cost are explicitly configured;
5. the route passes a current health check;
6. the quoted request passes `MIN_MARGIN_USD`, `MIN_MARGIN_PERCENT`, and `MAX_DAILY_LOSS_USD`;
7. a network credential is configured.

No migration seeds an active model. No pending revenue is reported as settled revenue or profit.

## Provider API

XGuard exposes a standard OpenAI-compatible surface:

- `GET /v1/models`
- `POST /v1/chat/completions`
- SSE streaming with upstream usage collection
- `GET /healthz` for liveness
- `GET /readyz` for route readiness
- `GET /v1/status` for public network/API/model status

The public site shows only active models, availability, latest latency, and network/API state. `/owner` and `/v1/admin/*` require the `XGUARD_ADMIN_TOKEN` bearer secret.

DGrid documents an OpenAI-compatible **consumer** Model API, but its public documentation does not publish the provider-channel handshake. XGuard therefore does not claim DGrid provider compatibility or acceptance until onboarding verifies that contract. See [DGRID.md](DGRID.md).

## Runtime secrets

Never commit these values:

- `DGRID_PROVIDER_API_KEY`
- `XGUARD_ADMIN_TOKEN`
- `XGUARD_PAYOUT_DESTINATION`
- `XGUARD_UPSTREAM_1_API_KEY` through `XGUARD_UPSTREAM_3_API_KEY`

Each upstream slot also requires non-secret runtime configuration for base URL, upstream model, DGrid-facing model, token prices, legal evidence URL, and `RESALE_APPROVED=true`. The attestation alone does not replace legal review.

## Profit protection

Before every upstream call, XGuard computes conservative maximum-token upstream, network-fee, and variable-infrastructure costs plus revenue. An unknown cost blocks the route. A request is blocked unless both dollar and percentage margin thresholds pass. It also blocks new work after the configured maximum daily loss.

After a successful response, XGuard records:

- an upstream cost as `USAGE_REPORTED` or `ESTIMATED`;
- network revenue as `PENDING`;
- settled revenue only after independently evidenced settlement.

The accounting state machine is `QUOTED → PENDING → SETTLED → WITHDRAWABLE → WITHDRAWN → RECEIVED_BY_OWNER`. See [PROFIT_MODEL.md](PROFIT_MODEL.md) and [PAYOUTS.md](PAYOUTS.md).

## Verification

```bash
npm ci --ignore-scripts
npm run inference:verify
```

This runs formatting, lint, strict type checks, unit tests, Cloudflare Worker integration tests with all D1 migrations, invariant validation, secret scanning, and a Wrangler production dry build.

An opt-in production smoke test performs real inference only when a network credential and an active model exist:

```bash
DGRID_PROVIDER_API_KEY='from-secret-store' npm run inference:smoke
```

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DGRID.md](DGRID.md)
- [PROFIT_MODEL.md](PROFIT_MODEL.md)
- [PAYOUTS.md](PAYOUTS.md)
- [PROVIDERS.md](PROVIDERS.md)
- [SECURITY.md](SECURITY.md)
- [OPERATIONS.md](OPERATIONS.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)

The `$350/day` figure is an operator target, not a forecast or claim. XGuard reports it as achieved only from settled revenue minus real recorded cost.
