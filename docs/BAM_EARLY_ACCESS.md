# BAM Early Access — XGuard ACE

## Project

**XGuard ACE** — deterministic stale-quote protection for opt-in Solana applications.

Repository: https://github.com/moelayyan90/XGuard  
Review surface: https://xguardgate.com

## Problem

BAM's public ACE design notes describe clear demand from trading applications for granular transaction-ordering controls, especially bounded speed bumps that protect market makers from aggressive taker flow executing against stale quotes.

## What XGuard implements

A small deterministic policy engine matching that design direction:

- applications opt in by program id
- protected flow receives a bounded 10–50ms delay
- explicitly marked top-level instructions bypass the delay
- indirect/CPI-style references are delayed conservatively
- composed transactions use the maximum matching delay
- unknown programs are untouched

The engine is pure Rust, has no network dependency, no database, no model inference, no transaction mutation, and no custody.

## Why this implementation

The critical path is intentionally boring. Scheduling guarantees should be auditable and reproducible. The policy is isolated from the BAM adapter so BAM-specific registration, TEE, routing, and accounting semantics can be integrated without changing the core rule engine.

## What is ready

- Rust policy engine
- configuration validation and resource bounds
- correctness tests for bypass, CPI/indirect references, composition, and invalid policies
- fixture-driven simulator
- security model and benchmark plan
- public machine-readable specification at `/spec.json`

## What we need from BAM

1. The supported ACE/plugin integration interface or SDK revision.
2. The expected application-registration source of truth for an early-access plugin.
3. The test environment and attestation expectations for plugin review.
4. Fee/accounting hooks, if third-party plugin fees are available in the current cohort.

## Integration principle

XGuard will adapt to BAM's supported interface rather than ship a reverse-engineered production dependency. The repository can be wired to the official adapter as soon as BAM provides the early-access contract.

## Contact

GitHub: `moelayyan90`  
Email: `mo.elayyan2023@gmail.com`
