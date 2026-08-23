# Benchmark Plan

XGuard does not publish performance claims until they are measured against the official BAM/Agave integration path.

## What to measure

- classification latency: p50 / p95 / p99 / max
- throughput: classifications per second per core
- allocation rate per transaction
- policy cache size versus number of enrolled applications
- delayed-pool memory pressure
- effect of transaction composition on classification cost
- end-to-end scheduler impact under 10ms, 20ms, and 50ms policies

## Workloads

1. 100% unrelated transactions
2. one enrolled high-volume application
3. 4,096 enrolled programs, mostly misses
4. protected top-level calls
5. explicit bypass calls
6. indirect/CPI-style references
7. transactions matching several enrolled programs
8. adversarial marker layouts near instruction-data boundaries

## Acceptance gates

Before requesting production activation, XGuard should demonstrate:

- deterministic replay: identical inputs produce byte-for-byte identical decisions
- no delay leakage to unknown programs
- bounded memory under delayed-flow saturation
- no unbounded per-transaction scan over registered programs in the BAM adapter
- stable behavior under composed transactions
- a reproducible benchmark harness tied to the exact BAM/Agave revision under review

## Current status

The repository contains correctness tests and fixtures. Mainnet or BAM-node performance numbers are intentionally absent until the official integration environment is available.
