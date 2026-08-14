# Current x402 protocol research

**Retrieved:** 2026-08-14 (Asia/Amman). **Rule:** current official specifications override project assumptions. Sources are the x402 Foundation documentation/repository, Coinbase Developer Platform documentation where provider behavior is relevant, official standards, and installed registry artifacts.

## Current baseline

- The current protocol generation is **x402 v2**. The project installs the official TypeScript packages at `2.22.0`; the version was independently checked against the npm registry on the retrieval date.
- v2 uses CAIP-2 network identifiers. Base is `eip155:8453`; Base Sepolia is `eip155:84532`.
- The HTTP transport uses `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and `PAYMENT-RESPONSE`. v1 `X-PAYMENT*` headers are not accepted.
- A generic facilitator exposes supported capabilities plus verify and settle operations. The official `HTTPFacilitatorClient` targets `/supported`, `/verify`, and `/settle`. A provider may expose additional branded API paths; Coinbase documents `/v2/x402/verify` and `/v2/x402/settle` for its own authenticated product.
- v2 facilitator requests contain `x402Version`, `paymentPayload`, and `paymentRequirements`. Payment requirements contain payment fields; resource metadata is carried by the payload/402 envelope.

Primary references: [x402 introduction](https://docs.x402.org/introduction), [client/server flow](https://docs.x402.org/core-concepts/client-server), [facilitator concept](https://docs.x402.org/core-concepts/facilitator), [network identifiers](https://docs.x402.org/core-concepts/network-and-token-support), [official repository](https://github.com/x402-foundation/x402), [CDP facilitator API](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/x402-facilitator/x402-facilitator).

## Schemes and flows

The current protocol documents:

- `exact`: fixed-price authorization and settlement; network implementations include EVM, SVM, and other families.
- `upto`: a maximum authorization with a lower actual settlement; currently EVM/Permit2 focused.
- `batch-settlement`: EVM escrow, off-chain cumulative vouchers, claims, settlement, and refunds.
- payment flows described by mechanism metadata include authorization, upfront, and escrow-style behavior.

XGuard `0.1.0-alpha.0` intentionally supports only **v2 `exact` EVM authorization flow**, with EIP-3009 and Permit2 validation, and enables only Base Sepolia. It does not advertise `upto`, batch settlement, SVM, or other network implementations. References: [scheme overview](https://docs.x402.org/schemes/overview), [exact](https://docs.x402.org/schemes/exact), [batch settlement](https://docs.x402.org/schemes/batch-settlement), [SDK feature matrix](https://docs.x402.org/sdk-features).

## Idempotency and settlement identity

The official `payment-identifier` extension is a resource-response-cache/idempotency mechanism with a configurable TTL. A server advertises it, a client supplies an identifier, and the resource server returns its cached application response for an identical retry. The extension declaration alone does not prove that this cache exists or works.

Therefore XGuard does **not** treat Payment Identifier as permanent settlement identity. It adds a permanent authorization key derived from the single-use onchain authorization domain. At its own facilitator boundary, XGuard validates and temporarily binds a Payment Identifier and caches the settlement result; it does not cache the merchant's protected HTTP/MCP response. Merchants must implement/shared-deploy that resource-response cache to claim end-to-end Payment Identifier idempotency. Reference: [Payment Identifier](https://docs.x402.org/extensions/payment-identifier).

## Failure and failover semantics

A verify failure or transport failure is safe to try on another compatible verifier because no value submission occurs. A settle request changes the safety boundary. Coinbase’s official troubleshooting guide explicitly notes that timeout/node/confirmation errors can be ambiguous and must be resolved from transaction/chain evidence rather than retried. XGuard marks every non-definitive post-submit result `AMBIGUOUS`, blocks retries, withholds billing, and opens reconciliation. Reference: [CDP troubleshooting](https://docs.cdp.coinbase.com/x402/support/troubleshooting).

## Extensions

### Lifecycle hooks

Resource-server extensions can enrich declaration, 402 responses, settlement responses, and scoped verify/settle lifecycle hooks. XGuard preserves extension payloads and requires a selected downstream route to advertise non-server-only extension keys, but XGuard does not itself implement, sign, or cryptographically verify those extension semantics. Its aggregate `/supported` response unions explicitly modeled payment kinds and conservatively intersects downstream facilitator-owned extension names and signer sets. It does not add the server/client-owned Payment Identifier extension to a facilitator capability response; the protocol response is not a per-kind extension matrix. Reference: [extensions overview](https://docs.x402.org/extensions/overview).

### Signed Offers and Receipts

Signed offers commit a resource server to proposed payment terms; signed receipts attest to service delivery. They improve audit/dispute evidence, but they are not blockchain settlement finality. XGuard’s gateway remains transparent to them. Reference: [official offer/receipt specification](https://github.com/x402-foundation/x402/blob/main/specs/extensions/extension-offer-and-receipt.md).

### Bazaar

Bazaar is an early, evolving, machine-readable discovery layer for HTTP resources and MCP tools. A facilitator that supports it may catalog valid extension metadata and expose `/discovery/resources` and search behavior; there is no universal registration assumption. A resource becomes eligible by using the official extension with method/tool input schema, output example/schema, description, and service metadata. The starter declares schema-complete metadata; the MCP example declares it only when the selected route advertises Bazaar. The current XGuard gateway does not proxy catalog-query endpoints and must not be described as a complete Bazaar facilitator. The public XGuard URL is a non-billable testnet gateway, not a paid resource, and has not been submitted to a catalog. Reference: [Bazaar](https://docs.x402.org/extensions/bazaar).

### Builder Code

Builder Code implements ERC-8021 attribution. It is attribution metadata, not a native mechanism for collecting XGuard’s `$0.002` fee. XGuard does not misuse it as fee collection. Reference: [Builder Code](https://docs.x402.org/extensions/builder-code) and [ERC-8021](https://eips.ethereum.org/EIPS/eip-8021).

## MCP

The official `@x402/mcp` package transports payment data through MCP request/result metadata and JSON-RPC errors; it is not merely an HTTP endpoint renamed as MCP. `apps/mcp-example` uses the official payment wrapper and XGuard’s official `FacilitatorClient` implementation, binds the payment resource to `mcp://tool/safe_echo`, and declares tool-shaped Bazaar metadata only when the selected facilitator route advertises Bazaar.

The current authoritative MCP specification is [2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28), with the official TypeScript SDK v2 published as split server/client packages. However, the current `@x402/mcp@2.22.0` artifact depends on `@modelcontextprotocol/sdk` 1.x. XGuard therefore pins the compatible 1.30.0 SDK (newest negotiated revision `2025-11-25`) for this example and does not claim native MCP 2026-07-28 SDK-v2 compatibility. The example uses local stdio; a deployed SSE or Streamable HTTP transport is still required for public Bazaar discovery. Reference: [x402 MCP guide](https://docs.x402.org/guides/mcp-server-with-x402), [MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28), and [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).

## Fee collection conclusion

No reviewed core field provides an appropriate generic way for a routing facilitator to divert an additional `$0.002` from the buyer without changing the merchant’s advertised payment terms. Builder Code is attribution, and offer/receipt is evidence. The implemented primary billing model is therefore a separately disclosed merchant prepaid service balance: reserve on submission, capture only after a successful final billable mainnet settlement, release on definitive failure, keep held on ambiguity, and never charge testnet or duplicate retries.

## Compatibility boundary

| Capability                         | Ecosystem status                                 | XGuard status                                                                  |
| ---------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| x402 v2 envelope and CAIP-2        | Current                                          | Implemented                                                                    |
| `/supported`, `/verify`, `/settle` | Current generic client                           | Implemented                                                                    |
| Exact EVM / EIP-3009               | Current                                          | Implemented, Base Sepolia enabled                                              |
| Exact EVM / Permit2                | Current                                          | Structural/binding validation implemented                                      |
| Payment Identifier                 | Current extension                                | Settlement-layer binding/cache; resource response cache remains merchant-owned |
| Signed Offers/Receipts             | Current extension                                | Transparent pass-through; no false finality claim                              |
| Bazaar                             | Current, evolving                                | HTTP/MCP metadata prepared; no catalog proxy or live listing                   |
| MCP                                | Current spec 2026-07-28; x402 wrapper on SDK 1.x | Paid stdio example compiles; no native MCP SDK-v2 claim                        |
| Builder Code                       | Current attribution extension                    | Not used for fees                                                              |
| `upto`, batch, SVM, other networks | Current ecosystem capabilities                   | Not advertised in this release                                                 |

## Research limitations

Facilitator costs, network/asset matrices, Bazaar behavior, and provider eligibility can change. Production startup must refresh `/supported`, and operations must re-check official pricing and legal/provider terms before enabling a route. No source was interpreted as endorsement of XGuard.
