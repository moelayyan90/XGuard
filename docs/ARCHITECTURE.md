# Architecture

## Scope

XGuard is a deterministic policy primitive for BAM Application Controlled Execution. It does one thing: classify transactions for an opt-in application speed bump without changing transactions, signing keys, application state, or validator consensus rules.

## Data path

```text
incoming transaction
        |
        v
BAM transaction router
        |
        v
adapter extracts:
- top-level program calls
- instruction data
- referenced account/program keys
        |
        v
xguard-core::classify()
        |
        +---- delay_ms = 0 ----> normal scheduler path
        |
        `---- delay_ms > 0 ----> bounded delayed pool ----> scheduler
```

The BAM adapter is intentionally a narrow boundary. The core policy has no dependency on an unpublished BAM SDK, TEE implementation, RPC client, network service, database, or AI model.

## Rule model

Each enrolled application has:

- `program_id`
- one or more top-level bypass markers
- `delay_ms` between 10ms and 50ms

Protected-by-default semantics reduce accidental bypasses. For an enrolled program, a transaction is delayed unless every top-level call to that program carries a configured bypass marker.

If the program is referenced by the transaction but is not directly invoked at top level, XGuard treats the transaction conservatively as indirect/CPI flow and applies the delay.

## Composition

A transaction can touch several enrolled programs. XGuard evaluates all matching rules and applies the maximum delay. This prevents a composed transaction from selecting a shorter rule to bypass a longer application-level speed bump.

## Determinism

`classify(config, transaction)` is a pure function. It has no wall-clock reads, random numbers, network calls, model inference, mutable global state, or external storage.

The output is determined only by:

- the validated policy configuration
- top-level instruction program ids and data
- the transaction's referenced account keys

Matched rules are sorted by program id before being returned so audit output is stable.

## Registration

The repository does not invent an off-chain registration authority. BAM's public ACE proposal discusses permissionless application registration and an on-chain source of truth. XGuard models the policy that such a registry would feed into the BAM node.

Until BAM publishes the production ACE registration and plugin SDK, the adapter remains an integration boundary rather than a proprietary compatibility layer.

## Runtime placement

The intended placement is inside the BAM routing/scheduling environment, before normal scheduler admission. It is not a user-facing proxy and does not require a trader, wallet, or market maker to install client software.

## Cloudflare

Cloudflare is used only for the public project surface at `xguardgate.com`. It is not on the Solana transaction critical path and does not participate in scheduling decisions.
