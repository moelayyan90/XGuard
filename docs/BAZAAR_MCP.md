# Bazaar and MCP readiness

Retrieved 2026-08-14. The current official [Bazaar documentation](https://docs.x402.org/extensions/bazaar) describes facilitator-supported discovery for resources carrying valid machine-readable metadata. It is evolving and does not imply a universal registry or automatic listing.

The starter's paid route supplies a description, HTTP method, input schema, output example/schema, MIME type, and service metadata using the official extension builder. Eligibility still depends on a deployed resource, a facilitator that supports Bazaar, valid metadata, and that facilitator's catalog behavior. XGuard has not claimed or received a listing.

Agent-facing metadata must state:

- that XGuard is a safety and facilitator-routing layer;
- x402 v2 exact-EVM/Base Sepolia compatibility for the alpha;
- `$0.002` per successful billable mainnet settlement, downstream costs separate;
- testnet and diagnostics are free;
- strict errors for unsupported, replay conflict, in-progress, ambiguous, and insufficient service balance;
- complete JSON input/output schemas and examples.

The official [x402 MCP guide](https://docs.x402.org/guides/mcp-server-with-x402) and `@x402/mcp` package transport payment requirements and payloads through MCP metadata/JSON-RPC behavior. `apps/mcp-example` uses that wrapper, identifies the paid resource as `mcp://tool/safe_echo`, and conditionally declares schema-complete MCP Bazaar metadata when the selected facilitator route advertises Bazaar. It offers a free diagnostic tool and a testnet paid-tool example; it is not an HTTP endpoint merely relabeled as MCP.

The current authoritative [MCP specification is 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28), and the current official TypeScript SDK v2 uses the split `@modelcontextprotocol/server` and `@modelcontextprotocol/client` packages. The official `@x402/mcp@2.22.0` package still depends on the MCP SDK 1.x compatibility line. Consequently this example deliberately pins `@modelcontextprotocol/sdk@1.30.0`, whose newest negotiated protocol revision is `2025-11-25`. It demonstrates compatibility with the current x402 MCP wrapper; it does **not** claim native MCP 2026-07-28 SDK-v2 compatibility.

The example currently runs over local stdio. The Bazaar extension accepts the tool schema without a transport field, but public MCP discovery and remote invocation require a deployed `sse` or `streamable-http` transport plus a Bazaar-enabled facilitator. If the route does not advertise Bazaar, the example withholds the extension instead of causing XGuard's extension-aware router to reject an otherwise valid payment. XGuard's gateway does not currently proxy the facilitator catalog-query endpoints. Therefore the example is metadata-ready, not publicly discoverable, listed, or remotely callable.

Before listing either surface, install from a clean environment, validate every schema, execute a real testnet payment, verify the public URL and status, confirm no secrets, and record measured uptime. No listing is reported until accepted.
