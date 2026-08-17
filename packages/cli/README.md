# xguard CLI

Safe migration and diagnostics for x402 v2 projects using the XGuard production gateway.

Production XGuard runs at `https://xguardgate.com` on Base mainnet.

After installing the verified CLI prerelease tarball from the XGuard GitHub release:

```bash
xguard init --gateway https://xguardgate.com
xguard doctor --endpoint https://your-production-resource.example/paid
xguard rollback
```

`init` edits only a literal URL in an actual `HTTPFacilitatorClient` constructor, creates local backups, runs existing tests, and restores all source/configuration files when tests fail. `rollback` refuses to overwrite later user changes. Source is inspected locally and never uploaded.

The CLI does not execute synthetic payments or create merchant funding. Mainnet billing remains governed by the hosted XGuard gateway: `$0.002` per successful billable settlement, using the merchant's prepaid service balance.

The current alpha CLI is distributed as a CI-built, smoke-tested GitHub prerelease tarball. The public npm name is prepared, but npm publication remains identity-gated; this README does not represent an unpublished npm tag as available.

For non-billable testing, pass the testnet gateway explicitly rather than treating testnet as the default environment.
