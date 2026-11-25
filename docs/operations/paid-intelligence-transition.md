# Paid intelligence rollout

The unit price is USD 0.001. The supported settlement rail uses 1,000 atomic USDC on Base for one unit. A batch of 100 fact lookups costs 100,000 atomic USDC. Pricing uses integer multiplication. The client checks the unit count, payer cap and treasury before signing.

## Production compatibility

The rollback source is `restore/2026-11-24-before-global-paid-infrastructure`, commit `0d33397ec0fc60b63ef0369eb1ed7c0301899578`. The deploy job also snapshots the active Cloudflare version immediately before rollout. Reader 7 understands a stored result prepared after verification and before settlement. Writer 6 can publish discovery and issue an offer but declines intelligence purchase attempts. Writer 7 may be promoted separately after the reader deployment. Preserve this reader or a newer revision for subsequent recovery.

The transition entry serves the new API under `/api/intelligence/v1`. Its MCP endpoint is `/api/intelligence/v1/mcp`, A2A is `/api/intelligence/v1/a2a`, and the schemas are at `/api/intelligence/v1/openapi.json`. The separately built paid-only entry applies the metering policy at the origin before caches, analytics and legacy handlers. Unsupported services return an unavailable response. Administration and existing paid-result recovery require the existing credentials. The production release exercises the strict entry with a version override at 0% normal traffic and then restores the single control version.

## GBLIN witness transition

GBLIN confirmed automatic C2SP checkpoint submission in [issue 211](https://github.com/moelayyan90/XGuard/issues/211#issuecomment-6796198734). XGuard and GBLIN originally agreed to keep witnessing separate from the payment path. The operator requested an isolated paid compatibility test and written acceptance of the new price on [November 24](https://github.com/moelayyan90/XGuard/issues/211#issuecomment-7127915193). An attestation canary on GBLIN's separate endpoint has different authorization and settlement terms. It does not authorize billing for witness submissions. Until the witness transition is agreed, the normal deployment uses the existing C2SP interface. The strict entry exposes its public verifier key and suspends cosignature delivery.

## Evidence and coverage

A source or preparation error prevents submitting the payment for settlement. A timeout after submission remains recoverable through the original quote and payment identifier. Independent Base transaction evidence precedes paid delivery. The operator can review confirmed deliveries at `/api/intelligence/v1/admin/revenue`, with the existing owner session or owner bearer credential. A POST with the owner bearer can attach monthly per-service invoice evidence (`month`, `service`, `amount_usd_micros`, `invoice_ref`) and, optionally, measured gross USD proceeds and their supporting statement (`gross_proceeds_usd_micros`, `proceeds_ref`). USD margins require both figures. Optional profit metrics reflect the completeness of the owner's cost allocations.

The OSV adapter supports six ecosystems. The npm compatibility adapter evaluates published engine and peer ranges. The breaking-change detector handles bounded OpenAPI 3.0/3.1 documents and explicitly reports unresolved constructs. Model cards and comparisons use published provider documentation. Third-party client installation, live account-specific limits, card prepayment, separately hosted services and the partner witness require their own verification. No simulated payment, quote, or monitor request establishes customer revenue.

## Settlement provider availability

Fresh Base purchases try the configured xpay facilitator first. If its circuit is open or it cannot advertise the exact USDC authorization, the Worker checks the already configured public PayAI endpoint. It sends no merchant API key and does not buy credits. PayAI documents that continuing beyond the public allowance requires an authenticated, funded account. A rejected verification or uncertain settlement stays with the provider recorded for the original operation. Provider advertisements and unsigned probes cannot establish a successful payment. See [PayAI authentication and public allowance](https://docs.payai.network/x402/facilitators/authentication).
