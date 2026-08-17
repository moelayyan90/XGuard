# Deployment

XGuard production runs at:

- **Production mainnet:** `https://xguardgate.com`
- **Network:** Base mainnet (`eip155:8453`)
- **Asset:** native Base USDC

A separate Base Sepolia Worker remains available only for explicit non-billable testing. Its deployment workflow is manual-only and it is not part of automatic production deployment or live monitoring.

The mainnet endpoint is technically deployed production infrastructure; that is not a claim of regulatory authorization, independent security certification, provider-contract completion, or unrestricted commercial availability in every jurisdiction.

## Mainnet technical deployment

The production Worker uses:

- `apps/worker/src/mainnet-modern.ts` as the canonical Cloudflare entrypoint;
- Base mainnet `eip155:8453`;
- native Base USDC;
- x402 v2 `exact` EIP-3009 authorization flow;
- SQLite Durable Objects for one-outbound settlement ownership, request coordination, and upstream quota control;
- D1 for merchant balances, top-up claims, settlement projection, finality, reconciliation, accounting, and discovery state;
- independent Base finality checks before a reserved XGuard fee becomes earned revenue;
- a configured public Base USDC treasury address whose controlling private key is not stored in source;
- one-minute scheduled production maintenance, with automatic relevant top-up scanning on a five-minute cadence.

The deployment workflow is hard-bound to `xguard-mainnet`. Before Wrangler can publish, it verifies the Worker name, `src/mainnet-modern.ts` entrypoint, D1 database name `xguard-mainnet`, and a syntactically valid mainnet treasury address. It applies remote D1 migrations before deploying the Worker.

After deployment, GitHub Actions requires live production checks covering health/readiness, Base mainnet x402 capability, public status, provider discovery, MCP, Bazaar/OpenAPI discovery, Glama ownership metadata, and the canonical mainnet smoke contract. A failed readiness/smoke verification fails the deployment job.

Reproduce the checked-in release validation locally without deploying:

```bash
npm ci --ignore-scripts
npm run verify:release
```

The authorized GitHub Actions workflow performs the actual Cloudflare deployment using encrypted Cloudflare deployment credentials. Secret values and private keys are not stored in source. The mainnet treasury **address** is public configuration; possession of an address does not grant control of its funds.

## Live monitoring

Production monitoring is mainnet-only:

```bash
npm run smoke:mainnet
```

GitHub Actions runs the non-payment mainnet smoke every 30 minutes and after a successful `Deploy XGuard mainnet` workflow. It creates one deduplicated GitHub issue when mainnet smoke fails and closes that issue after recovery.

The production smoke test does not register a merchant, fund a balance, sign a payment, or submit a settlement. It verifies liveness/readiness, Base x402 capability, facilitator health, provider/discovery surfaces, MCP/Glama exposure, billing metadata privacy, and reconciliation state.

`npm run smoke:live` remains available for explicit/manual testnet verification; it is not part of the automatic production monitor.

## Mainnet billing deployment boundary

Merchant registration creates a bearer XGuard API key. Mainnet is prepaid: a merchant creates a one-time top-up intent, sends the exact native-USDC amount on Base to the returned treasury address, and claims the finalized transaction. The deposit credits a customer service balance and remains a liability until service is earned.

For an eligible settlement, XGuard reserves `$0.002` from the merchant service balance. Downstream settlement success alone does not earn the fee. Independent finality must confirm the Base USDC settlement before accounting transitions the reserved fee to earned revenue.

## External release/compliance limitations

Technical deployment does not by itself resolve external legal, provider, security-attestation, banking/off-ramp, or package-registry requirements.

1. **Regulatory classification/authorization.** A live technical deployment must not be represented as legally cleared without current jurisdiction-specific evidence for the deployed architecture.
2. **Downstream provider scaling/authorization.** The live provider manifest and status endpoint are authoritative for current downstream attribution. The repository does not claim that every paid provider tier, commercial contract, or account approval needed for future scale has been obtained.
3. **Independent mainnet security review.** CI, CodeQL, adversarial tests, replay/concurrency controls, finality verification, and runtime smoke checks are first-party evidence, not an independent external security attestation.
4. **Bank/off-ramp payout.** A crypto treasury and earned-fee accounting do not by themselves establish an automated regulated bank payout path or prove distributable owner profit.
5. **npm trusted publishing/ecosystem acceptance.** Verified GitHub prerelease tarballs are published and smoke-tested, but npm ownership/trusted publishing and third-party directory acceptance remain separate authenticated processes where applicable.

See [External blockers](docs/EXTERNAL_BLOCKERS.md), [Treasury](TREASURY.md), and [Payouts](PAYOUTS.md).

## Optional testnet

The separate Base Sepolia Worker is non-billable and remains useful for explicit integration testing. It is isolated from the mainnet merchant billing path, does not receive automatic pushes from `main`, and is not included in the production live-monitor workflow.

## Fail-closed principle

No environment variable, documentation statement, or downstream response is treated as sufficient proof of a final financial event. XGuard requires explicit network/asset constraints, merchant authentication, one-outbound ownership, replay identity, D1 accounting, and independent finality evidence before earning a mainnet service fee.
