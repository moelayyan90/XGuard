# Deployment

XGuard production runs at:

- **Production mainnet:** `https://xguardgate.com`
- **Network:** Base mainnet (`eip155:8453`)
- **Asset:** native Base USDC
- **Canonical x402 attempt fee:** `$0.03` / `30,000` micro-USD

A separate Base Sepolia Worker remains available only for explicit non-billable testing. Its deployment workflow is manual-only and it is not part of automatic production deployment or live monitoring.

The mainnet endpoint is technically deployed production infrastructure; that is not a claim of regulatory authorization, independent security certification, provider-contract completion, or unrestricted commercial availability in every jurisdiction.

## Mainnet technical deployment

The checked-in mainnet Wrangler configuration uses **`apps/worker/src/universal-mainnet.ts`** as the `xguard-mainnet` entrypoint. That universal layer exposes the current public payment contract and protocol/discovery surfaces, then delegates protected x402 execution through the monetized mainnet path and the modern settlement stack.

The production stack uses:

- Base mainnet `eip155:8453`;
- native Base USDC;
- x402 v2 `exact` EIP-3009 authorization flow;
- SQLite Durable Objects for one-outbound settlement ownership, request coordination and upstream quota control;
- D1 for merchant balances, top-up claims, settlement projection, finality, reconciliation, accounting and discovery state;
- independent Base finality checks for settlement truth and reconciliation;
- a configured public Base USDC treasury address whose controlling private key is not stored in source;
- one-minute scheduled production maintenance, with relevant top-up scanning on its configured cadence.

The canonical public x402 fee is defined in `apps/worker/src/public-payment-contract.ts` and the deployment configuration must use `XGUARD_FEE_MICRO_USD=30000`. The runtime imports the same public fee constants rather than maintaining an independent hard-coded amount.

After deployment, GitHub Actions performs live production checks covering health/readiness, Base mainnet x402 capability, public status, payment/provider discovery, MCP, Bazaar/OpenAPI discovery and the canonical mainnet smoke contract. A failed required release or smoke verification fails the deployment job.

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

The production smoke must not create an accidental paid transaction merely to check liveness. It verifies public health/readiness, Base x402 capability, provider/discovery surfaces, MCP exposure, billing metadata privacy and reconciliation state. Payment-path checks that require a funded merchant are separate explicit tests.

`npm run smoke:live` remains available for explicit/manual testnet verification; it is not part of the automatic production monitor.

## Mainnet billing deployment boundary

Merchant registration creates a bearer XGuard API key. Mainnet is prepaid: a merchant creates a one-time top-up intent, sends the exact native-USDC amount on Base to the returned treasury address, and claims the finalized transaction. The deposit credits a customer service balance and remains a liability until service is earned.

For protected x402 `/verify` and `/settle`, XGuard charges **$0.03 once per accepted authenticated economic attempt**. Acceptance requires authentication, supported request parsing, a canonical `logicalPaymentKey`, and successful fee reservation from prepaid service balance. The fee is earned before downstream execution. A downstream failure does not refund it, while an idempotent retry for the same logical payment key adds no second attempt fee.

Independent Base finality remains authoritative for **settlement truth**, not for deciding when the fixed attempt fee is earned.

## External release/compliance limitations

Technical deployment does not by itself resolve external legal, provider, security-attestation, banking/off-ramp or package-registry requirements.

1. **Regulatory classification/authorization.** A live technical deployment must not be represented as legally cleared without current jurisdiction-specific evidence for the deployed architecture.
2. **Downstream provider scaling/authorization.** The live provider manifest and `/supported` endpoint are authoritative for current downstream attribution and x402 capability. The repository does not claim that every paid provider tier, commercial contract or account approval needed for future scale has been obtained.
3. **Independent mainnet security review.** CI, CodeQL, adversarial tests, replay/concurrency controls, finality verification and runtime smoke checks are first-party evidence, not an independent external security attestation.
4. **Bank/off-ramp payout.** A crypto treasury and earned-fee accounting do not by themselves establish an automated regulated bank payout path or prove distributable owner profit.
5. **npm trusted publishing/ecosystem acceptance.** Verified GitHub prerelease artifacts and third-party directory acceptance remain separate authenticated processes where applicable.

See [External blockers](docs/EXTERNAL_BLOCKERS.md), [Treasury](TREASURY.md), and [Payouts](PAYOUTS.md).

## Optional testnet

The separate Base Sepolia Worker is non-billable and remains useful for explicit integration testing. It is isolated from the mainnet merchant billing path, does not receive automatic production pushes merely because `main` changed unless its manual workflow is invoked, and is not the production source of truth.

## Fail-closed principle

No environment variable, documentation statement or downstream response alone is treated as sufficient proof of a final financial transfer. XGuard requires explicit network/asset constraints, merchant authentication, one-outbound ownership, replay identity, D1 accounting and independent finality evidence for settlement truth. Billing-event identity is separately fixed by the canonical public payment contract.
