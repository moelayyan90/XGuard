# Deployment

The global commerce worker uses `src/commerce-mainnet.ts`, re-exporting all existing Durable Object classes from the universal mainnet entrypoint. The mainnet deploy workflow resolves the production D1 identifier, applies migrations, deploys the Worker, and verifies `/v1/commerce/status`. The Resend DNS workflow configures the official `xguardgate.com` mail records on main-branch pushes.
