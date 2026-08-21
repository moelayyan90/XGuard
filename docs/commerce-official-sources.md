# XGuard official commerce sources

XGuard only treats public procurement data as buyer-demand evidence. It never treats a public tender value as collected cash or an awarded supplier as live inventory.

Sources:
- UK Find a Tender OCDS release package API.
- UK Contracts Finder OCDS search API (secondary/legacy coverage).
- EU TED Search API when the runtime probe confirms the current v3 response contract.
- ECB EXR reference-rate API for currency normalization only.

Execution remains gated by explicit buyer-funds, identity and supplier-inventory verification.
