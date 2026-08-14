XGuard Deploy-Ready
===================

This package contains NO Cloudflare API token and NO bank credentials.

Already configured:
- Live testnet URL: https://xguard-testnet.maqamapp.workers.dev
- Cloudflare D1 name: xguard-testnet
- Worker name: xguard-testnet
- The current account/database identifiers are preserved only in the ignored
  apps/worker/wrangler.local.jsonc file and are not published to GitHub.
- MODE: testnet
- XGuard fee config remains $0.002, but testnet billing is disabled by code/policy.
- Paid-plan-only explicit 30s Worker CPU override removed so the package can deploy on Workers Free using the Free plan's native limits.
- Real Base Sepolia x402 settlement has succeeded and was confirmed onchain.
- Three historical DataCloneError ambiguities were reconciled against confirmed Base Sepolia transfers; the live open-reconciliation count is zero.
- Mainnet remains hard-disabled. Testnet never bills and has produced $0.00 XGuard revenue.

Do not paste your Cloudflare API token into chat or source files.
DEPLOY-XGUARD.ps1 prompts for it securely and clears it from the process environment when finished.
