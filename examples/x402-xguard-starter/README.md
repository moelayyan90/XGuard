# x402 + XGuard starter

This is a minimal Base Sepolia seller using the official x402 v2 Express middleware and XGuard as its facilitator client.

1. Copy `.env.example` to an untracked `.env` and set a testnet receiving address. Never put a private key in the server.
2. Keep the default live testnet `XGUARD_URL`, or replace it with a local gateway.
3. From the repository root, run `npm install`, `npm run build`, then `node examples/x402-xguard-starter/dist/server.js`.

The `/paid` resource advertises Payment Identifier. It adds schema-complete Bazaar metadata only when the configured facilitator reports Bazaar support, so the default route is not falsely advertised as discovery-capable. Testnet is never billed by XGuard. The example does not implement the shared protected-response cache required for complete Payment Identifier retry semantics.
