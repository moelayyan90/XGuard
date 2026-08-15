# Deployment

XGuard currently has separate live Cloudflare Workers for Base Sepolia testnet and Base mainnet.

- Testnet: `https://xguard-testnet.maqamapp.workers.dev`
- Mainnet: `https://xguard-mainnet.maqamapp.workers.dev`

The mainnet endpoint is **technically deployed**, not a claim of regulatory authorization, independent security certification, provider-contract completion, or unrestricted commercial availability in every jurisdiction.

## Mainnet technical deployment

The mainnet Worker uses:

- Base mainnet `eip155:8453`;
- native Base USDC;
- x402 v2 `exact` EIP-3009 authorization flow;
- SQLite Durable Objects for one-outbound settlement ownership and concurrency control;
- D1 for merchant balances, top-up claims, settlement projection, reconciliation, and accounting events;
- independent Base finality checks before a reserved XGuard fee becomes earned revenue;
- the configured Base USDC treasury address through an encrypted GitHub Actions secret;
- scheduled facilitator health and finality maintenance.

The deployment workflow creates/resolves `xguard-mainnet`, applies D1 migrations, deploys the Worker, and then requires live `/healthz`, `/readyz`, `/supported`, and `/status` checks to pass. A failed readiness verification fails the deployment job.

Reproduce the checked-in release validation locally without deploying:

```bash
npm ci --ignore-scripts
npm run verify:release
```

The authorized GitHub Actions workflow performs the actual Cloudflare deployment using encrypted `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `XGUARD_TREASURY_USDC_ADDRESS` repository secrets. Secret values are not stored in source.

## Live monitoring

The repository contains non-payment smoke checks for both public gateways:

```bash
npm run smoke:live
npm run smoke:mainnet
```

The mainnet smoke test checks liveness, readiness, Base x402 capability, facilitator health, configured unit economics, and fail-closed merchant authentication. It does not register a merchant, fund a balance, sign a payment, or submit a settlement.

GitHub Actions runs testnet and mainnet monitoring every 30 minutes and records a GitHub issue when a target fails.

## Mainnet billing deployment boundary

Merchant registration creates a bearer XGuard API key. Mainnet is prepaid: a merchant creates a one-time top-up intent, sends the exact native-USDC amount on Base to the returned treasury address, and claims the finalized transaction. The deposit credits a customer service balance and remains a liability until service is earned.

For an eligible settlement, XGuard reserves `$0.002` from the merchant service balance. Downstream settlement success alone does not earn the fee. Independent finality must confirm the Base USDC settlement before accounting transitions the reserved fee to earned revenue.

## External release/compliance gates still unresolved

Technical deployment does not resolve these external matters:

1. **Jordan regulatory classification/authorization.** The project owner sent a written classification request to the Jordan Securities Commission on 2026-08-14. That message described a testnet-only architecture. The architecture later changed materially by adding a live mainnet endpoint, merchant registration, prepaid Base USDC service balances, and mainnet settlement routing. No reply from `info@jsc.gov.jo` or `legal@jsc.gov.jo` was present in the connected mailbox when checked on 2026-08-15. The final architecture therefore still needs a current written Jordan-qualified classification before it is represented as legally cleared.
2. **PayAI scaling authorization.** The public route can use PayAI's advertised free allowance, but provider documentation states that scaling through paid usage uses merchant credits/API credentials. XGuard supports scoped PayAI deployment secrets, but this repository does not claim that a paid provider account or contract has been approved for the owner.
3. **Independent mainnet security review.** CI, CodeQL, adversarial tests, replay/concurrency controls, and runtime smoke checks are first-party evidence. They are not an independent external security attestation.
4. **Bank/off-ramp payout.** Merchant Base USDC can reach the configured crypto treasury, but no automated regulated bank payout connector is active. The project must not equate treasury receipts with distributable owner profit.
5. **npm trusted publishing/ecosystem listing.** Source-level integration works without an XGuard package release, but public npm ownership/trusted publishing and third-party directory acceptance require their own authenticated actions.

See [External blockers](docs/EXTERNAL_BLOCKERS.md), [Treasury](TREASURY.md), and [Payouts](PAYOUTS.md).

## Testnet

The separate Base Sepolia Worker remains non-billable and is useful for integration testing without XGuard service fees. Its configuration and financial state are isolated from the mainnet merchant billing path.

## Fail-closed principle

No environment variable, documentation statement, or downstream response is treated as sufficient proof of a final financial event. XGuard requires explicit network/asset constraints, merchant authentication, one-outbound ownership, replay identity, D1 accounting, and independent finality evidence before earning a mainnet service fee.
