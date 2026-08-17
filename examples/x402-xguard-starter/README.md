# x402 + XGuard starter

This is a minimal Base mainnet seller using the official x402 v2 Express middleware and XGuard as its facilitator client.

**This production example can participate in real Base mainnet payments.** It refuses to start until you explicitly provide both a merchant `XGUARD_API_KEY` and a non-zero `PAY_TO_MAINNET_ADDRESS`. Never put a private key in the server or repository.

1. Copy `.env.example` to an untracked `.env`.
2. Set `XGUARD_API_KEY` to the key returned by XGuard mainnet merchant registration.
3. Set `PAY_TO_MAINNET_ADDRESS` to the Base mainnet address that should receive the seller's advertised x402 payment.
4. Keep the production `XGUARD_URL=https://xguard-mainnet.maqamapp.workers.dev` unless you are deliberately targeting another explicit environment.
5. From the repository root, run `npm install`, `npm run build`, then `node examples/x402-xguard-starter/dist/server.js`.

The `/paid` resource advertises a `$0.001` seller payment on Base mainnet. XGuard's `$0.002` successful-settlement service fee is separate from that seller-advertised amount and is charged against the merchant's prepaid XGuard service balance according to the production billing boundary.

The resource advertises Payment Identifier. It adds schema-complete Bazaar metadata only when the configured facilitator reports Bazaar support, so the route is not falsely advertised as discovery-capable. The example does not implement the shared protected-response cache required for complete Payment Identifier retry semantics.

For non-billable Base Sepolia testing, use the separate testnet gateway and testnet network explicitly rather than changing the production starter defaults implicitly.
