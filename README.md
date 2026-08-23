# XGuard ACE

Deterministic stale-quote protection for Solana applications using BAM Application Controlled Execution (ACE).

XGuard implements the opt-in application speed-bump primitive described publicly by the BAM team: enrolled applications can delay protected flow for a bounded 10–50ms window while explicitly marked instructions stay on the normal path. The critical path is deterministic and contains no LLM or probabilistic classifier.

## Why this exists

BAM has documented clear demand from trading applications for granular transaction-ordering controls, especially speed bumps that give market makers time to refresh quotes before aggressive taker flow executes against stale state.

Design basis:

- BAM ACE proposal: https://forum.bam.dev/t/brainstorming-paths-to-ace-on-bam/28
- BAM plugin overview: https://bam.dev/
- Maker Priority Plugin: https://bam.dev/docs/bam/maker-plugin/how-it-works/

## Policy

For each enrolled program:

1. Unknown programs stay on the normal scheduling path.
2. A top-level call without a configured bypass marker is delayed.
3. A top-level call with an explicit bypass marker stays on the normal path.
4. An indirect/CPI-style reference to an enrolled program is delayed conservatively.
5. If a composable transaction matches several enrolled programs, the maximum delay wins.
6. Delays are bounded to 10–50ms.

This is deliberately small. It is intended to be reviewable, deterministic, and cheap enough to sit in a transaction-routing path.

## Repository

- `crates/xguard-core` — pure Rust policy engine and invariants
- `crates/xguard-sim` — fixture-driven simulator
- `examples/` — reproducible policy and transaction fixtures
- `apps/portal` — Cloudflare Worker serving xguardgate.com and the machine-readable product spec
- `docs/ARCHITECTURE.md` — execution model and BAM integration boundary
- `docs/SECURITY.md` — failure model, abuse controls, and non-goals
- `docs/BENCHMARKING.md` — benchmark plan; no fabricated performance numbers
- `docs/BAM_EARLY_ACCESS.md` — concise technical application for BAM early access

## Run the simulator

```bash
cargo run -p xguard-sim -- examples/rules.json examples/transactions.json
```

## Validate

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
node --check apps/portal/src/index.js
```

## Status

The policy engine, simulator, tests, documentation, and public review surface are implemented in this repository. Production activation inside BAM requires the official ACE/plugin integration path and BAM early-access approval. XGuard does not claim production BAM traffic before that integration exists.

## License

Apache-2.0.
