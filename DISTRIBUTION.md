# Distribution

## Primary adoption path

The recommended production seller flow is intentionally small:

```text
merchant opens /start
        ↓
connect payTo wallet + sign exact XGuard terms once
        ↓
facilitator URL = https://xguardgate.com
        ↓
standard x402 /verify + /settle
```

No XGuard account, email, password, API key, package, subscription, or prepaid balance is required for that standard x402 seller path after activation.

The activation signature proves control of the seller's existing `payTo` and accepts disclosed pricing. It does not authorize a transfer and does not replace the merchant's x402 payment recipient.

## Adoption surfaces

- `https://xguardgate.com/start`: primary one-signature merchant activation.
- `https://xguardgate.com`: canonical facilitator base URL.
- `/.well-known/payment-manifest`: machine-readable pricing/onboarding contract.
- `/.well-known/x402/facilitator.json`: provider/facilitator metadata.
- `/supported`: x402 capability discovery.
- `xguard init`: optional local migration/diagnostic automation.
- `xguard rollback`: hash-safe restoration for CLI migrations.
- `xguard doctor`: repository and live-endpoint diagnostics.
- `@xguard/sdk`: optional compatibility wrapper; not required for hosted x402 use.
- `examples/x402-xguard-starter`: should demonstrate the same one-signature activation + public facilitator URL.
- `/discovery/resources`, `/discovery/search`, `/mcp`: secondary discovery surfaces.

The economic traffic path is:

```text
buyer -> merchant paid API/MCP tool -> XGuard /verify + /settle -> downstream facilitator -> Base
                                      |
                                      +-> independent XGuard finality/truth
                                      |
                                      +-> postpaid XGuard fee only after final success
```

MCP/directory listings improve discovery but do not themselves place XGuard in a merchant's payment path. Distribution work should prioritize places where x402 sellers choose/configure their production facilitator.

## Package publication

Hosted production use does not require an XGuard npm package.

The candidate npm names remain `xguard`, `@xguard/core`, and `@xguard/sdk`. They must not be described as npm-published until an authorized owner has completed publishing and registry evidence proves availability.

CI-built alpha tarballs may be published through GitHub Releases for CLI/SDK diagnostics. Package publication is an adoption convenience, not a prerequisite for the hosted facilitator URL.

## Production publication sequence

1. Keep CI, CodeQL, payment-security checks, secret scanning and protected-branch controls green.
2. Merge only code that passes `npm run verify:release`.
3. Apply D1 migrations before deploying the `xguard-mainnet` Worker.
4. Verify live `/healthz`, `/readyz`, `/supported`, `/status`, `/start`, payment manifest, provider manifest and x402 smoke behavior after deployment.
5. Keep pricing, activation terms, public docs and machine-readable manifests identical.
6. Publish optional CLI/SDK artifacts only after their release checks pass.
7. Keep official/third-party directory metadata pointed at the canonical `https://xguardgate.com` surfaces.
8. Submit to x402 facilitator/provider lists with accurate routing, signer attribution, pricing, supported network and activation requirements.

Current directory/listing evidence remains tracked in `.github/xguard-directory-status.json`. Submission is not called acceptance until evidence proves acceptance.

## Listing quality gate

Every public claim should be verifiable:

- URLs work;
- examples use the current activation model;
- no docs tell a new x402 seller to create an API key or prepaid balance;
- pricing matches the terms signed during activation;
- downstream signer attribution remains with the actual submitter;
- security/test status is accurate;
- no secret or private key is exposed;
- no fake usage, reviews, stars, settlements or endorsement claims are used.

## Legacy compatibility

Older authenticated/prepaid universal-gateway endpoints remain available for existing integrations. They are not the primary x402 adoption path and should not be surfaced ahead of `/start` + the public facilitator URL.

XGuard is independent infrastructure and must not be represented as an official x402 Foundation, Coinbase, xpay, Cloudflare, Base or Circle product unless such status is actually granted.
