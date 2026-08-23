# XGuard official commerce sources

XGuard treats public procurement data as buyer-demand evidence only. A published tender value is never treated as collected cash, and an awarded supplier is never treated as live inventory.

Production sources:

- UK Find a Tender OCDS release package API: active tender demand and award-derived supplier candidates.
- UK Contracts Finder OCDS search API: secondary/legacy UK coverage using the same fail-closed model.
- ECB EXR reference-rate API: currency normalization only; no guessed FX fallback.
- EU TED Search API adapter: parser is implemented, but live imports are accepted only when the public API actually returns notices. A zero/empty upstream result does not create synthetic demand.

The production scheduler checks source state on each cron cycle, refreshes official sources at a bounded cadence, overlaps the prior successful window to avoid missing late updates, follows only same-origin HTTPS pagination, and caps both response size and page count.

Execution remains gated separately by explicit buyer-payment, buyer-funds, buyer-identity, supplier-identity and supplier-inventory verification.
