# xguard CLI

Safe migration and diagnostics for x402 v2 projects.

```bash
npx xguard@next init --gateway https://xguard-testnet.maqamapp.workers.dev
npx xguard@next doctor --endpoint https://your-testnet-resource.example/paid
npx xguard@next rollback
```

`init` edits only a literal URL in an actual `HTTPFacilitatorClient` constructor, creates local backups, runs existing tests, and restores all source/configuration files when tests fail. `rollback` refuses to overwrite later user changes. Source is inspected locally and never uploaded.

The `0.1.0-alpha.0` release is testnet-only and is not yet published. The prerelease workflow uses npm's `next` tag; `latest` is reserved for a future stable release. See the project README for compatibility, pricing, and security boundaries.
