# XGuard executed test evidence

**Release candidate:** `0.1.0-alpha.0`  
**Execution date:** 2026-08-14 (Asia/Amman)  
**Runtime:** Node.js `v24.14.0`  
**Scope:** local plus live Cloudflare/Base Sepolia testnet; no owner funds, mainnet, or billable event

## Release checks

| Check                            | Executed result                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Prettier                         | PASS — all repository files matched                                                                             |
| ESLint                           | PASS — zero warnings/errors                                                                                     |
| TypeScript project build         | PASS                                                                                                            |
| Node Vitest suite                | PASS — 10 files, 72 tests                                                                                       |
| Cloudflare Workers-runtime suite | PASS — 1 file, 13 tests                                                                                         |
| Dependency audit                 | PASS — zero vulnerabilities at `high` threshold                                                                 |
| Secret scan                      | PASS — repository files checked; local wallet secret values neither scanned into output nor printed             |
| Executable TODO/FIXME/HACK scan  | PASS — none                                                                                                     |
| D1 migration SQL                 | PASS — applied to a clean SQLite database; integrity `ok`                                                       |
| Node SQLite backup/restore       | PASS — restored to a new path, reconciled, fixture present, integrity `ok`                                      |
| Reconciliation                   | PASS — balanced local ledger; live D1 has zero open ambiguity after evidence-based repair                       |
| Payout dry policy check          | PASS — `DISABLED`, no transfer submitted, provider `EXTERNAL_BLOCKER`                                           |
| CLI executable surface           | PASS — `init`, `doctor`, and `rollback` help loaded from compiled output                                        |
| Local HTTP smoke                 | PASS — root, health, status, supported, metrics; readiness correctly failed without a measured live local route |
| Worker generated types/build     | PASS — generated-type check and Cloudflare dry build                                                            |
| npm package dry packs            | PASS — core, SDK, and CLI include only allowlisted runtime/types/docs/license files                             |
| npm tarball install/import       | PASS — all three tarballs installed in an empty project; core/SDK imports and CLI executable loaded             |
| Starter example smoke            | PASS — compiled starter initialized through the live facilitator and returned `402` with `PAYMENT-REQUIRED`     |
| Live Cloudflare smoke            | PASS — live/ready/supported/status, malformed-input rejection, zero reconciliation, and mainnet rejection       |
| Base Sepolia chain evidence      | PASS — successful USDC Transfer receipts independently retrieved for all five recorded test settlements         |

## Coverage

| Metric     |                 Result |
| ---------- | ---------------------: |
| Statements | 76.85% (1,451 / 1,888) |
| Branches   | 70.66% (1,190 / 1,684) |
| Functions  |     87.24% (260 / 298) |
| Lines      | 78.16% (1,400 / 1,791) |

## Concurrency and financial safety

The adversarial suite proved:

- 10, 100, and 1,000 simultaneous duplicates produce one outbound settlement owner;
- a completed retry returns the stored result without a second settlement or bill;
- post-submit uncertainty stays `AMBIGUOUS` and cannot be retried automatically;
- mainnet cannot finalize without independent evidence;
- testnet produces no usage charge;
- EIP-3009 and Permit2 identities reject altered or malformed binding;
- payout preparation cannot bypass safety, reuse provider fees, spend through open reconciliation, or resubmit ambiguity;
- provider returns and fees create balanced compensating entries;
- facilitator capability probes do not follow redirects;
- non-plain facilitator settlement objects are serialized into strict JSON data before Durable Object RPC, and replay returns the cached result without a second downstream call.

## Deterministic and live x402 evidence

The deterministic Node demo verified routing, deduplication, zero-fee testnet accounting, one outbound call, and a balanced ledger without broadcasting a transaction.

Separately, the live Worker completed a real signed x402 Base Sepolia flow from `402` through `/verify`, `/settle`, HTTP `200`, and confirmed onchain USDC transfer. The two directly projected successful settlements are [0xd290…d57](https://sepolia.basescan.org/tx/0xd290634d293ee3aa462613460a119ef05070e3b58d6776e9b65d5f012b48dd57) and [0x0561…85f](https://sepolia.basescan.org/tx/0x0561476cfab5719362450f77cda2e052b381a5bf7a126811d517546a3b5da85f).

The three historical `DataCloneError` records were not retried. Each was matched to a successful USDC Transfer using immutable payment evidence and timing: [0xc309…c0c](https://sepolia.basescan.org/tx/0xc3098efdf6fa94ebc6aec09d29aff2791230c4a88dea7ad84782274c4cf14c0c), [0xb650…467](https://sepolia.basescan.org/tx/0xb650b46aa2e1ed09ed97d6b398efae63329097e0fe172d95fb86ace116c11467), and [0x576f…27d](https://sepolia.basescan.org/tx/0x576fc417dbc2c19a55c2916c7f2a4dfdb69ce5785f7099b015a6f1a9989927d3). Conditional D1 updates changed only those projections from `AMBIGUOUS` to `SETTLED` and their cases from `OPEN` to `RESOLVED`.

After reconciliation, live `/status` reported zero open cases. D1 reported zero billable events and zero billed micro-USD. No testnet fee or revenue was created.
