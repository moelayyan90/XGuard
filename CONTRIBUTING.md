# Contributing

XGuard handles financial state. Changes favor explicit safety and auditability over feature count or latency shortcuts.

## Development

Use Node.js 22 or newer and a clean dependency install:

```bash
npm ci --ignore-scripts
npm run check
```

Protocol behavior must cite the current official x402 specification or SDK behavior. Do not invent fields or advertise an untested network, asset, scheme, extension, framework, or facilitator. Money uses bigint atomic units or integer micro-USD only.

## Change requirements

- New settlement paths need state-transition, replay, definitive-failure, timeout/ambiguity, and concurrent-duplicate tests.
- New facilitators need current capabilities, response validation, timeout classification, independent cost, and quarantine tests.
- Ledger changes need balanced postings, idempotency, immutable history, correction, reserve, and payout-invariant tests.
- Provider webhooks need official signature verification, timestamp window, unique event ID, bounded input, and replay tests.
- Database migrations must be additive/reversible where practical and include backup/restore evidence.
- Public API or CLI changes require examples and removal/rollback instructions.

Never include credentials, keys, seed phrases, customer payloads, personal data, or payout destination details in code, issues, fixtures, logs, screenshots, commits, or CI output. Report vulnerabilities through the private channel described in [SECURITY.md](SECURITY.md); do not publish sensitive vulnerability details in a normal issue.

Pull requests must pass formatting, lint, strict typecheck, Node and Workers-runtime tests, protocol tests, secret scan, unfinished-marker scan, dependency audit, and build. Major dependency upgrades are reviewed and tested rather than automatically deployed.
