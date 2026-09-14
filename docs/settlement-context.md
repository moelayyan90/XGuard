# Stateless settlement payment context

The reported production Worker version `9880d371-e1f2-4484-af03-70ecdf6a6eea`
maps to commit `04753d1f0313beca143ecb6fc48d3b13d09c882e` (deployment run 34880611907).
The `missing_payment_context` branch is in the payment firewall. It means one of
the requirements, signed payload, or accepted requirements is missing. It does
not mean a previous request's in-memory verification has expired. The event
provided no caller identity or request shape, so its original caller is not proven.

## Required request and trust boundary

Both `POST /verify` and `POST /settle` accept the official x402 v2 envelope:

```js
{
  x402Version: 2,
  paymentPayload,       // full signed payload, including accepted and payload
  paymentRequirements  // the requirements selected by the resource server
}
```

Send both objects on every call. A payment identifier, nonce, prior HTTP 200,
client `isValid` field, or "verified" header cannot replace them.

The firewall validates requirement/accepted binding and Base USDC authorization
recipient, value, nonce and validity window. Supported envelope aliases are
normalized before forwarding; conflicting aliases are rejected. Missing fields
are reported without logging payment signatures or bearer credentials.

For a new settlement, the relay calls its configured upstream verifier within
the same request. Only a successful `isValid: true` response with a matching
payer creates a server-side `TrustedVerifiedPaymentContext`. Quota admission,
billing and the settlement subrequest follow that verification. Failure or outage
cannot enter the late-settlement recovery path. No process-local authentication
cache, client-supplied trust header or previous `/verify` request is used.

Confirmed retries use Durable Object receipts. New receipts bind the canonical
payment envelope digest, and changed context returns 409. Receipts predating this
change retain their existing replay contract, now checked against network, asset,
payer, recipient and amount. This does not introduce a new guarantee for concurrent
unconfirmed requests or extend the existing authorization validity window.

## Caller inventory

All 153 code/configuration/documentation files (including PHP integrations) were
read because repository code search did not return indexed matches.

| Caller | Settlement path | Context source |
| --- | --- | --- |
| `sdk/index.js` and Express/Hono/Next/MCP examples | official HTTPFacilitatorClient through XGuard | SDK serializes full payload and requirements per call |
| `apps/edge-gate/src/index.js`, Universal Gate | official x402 resource server through XGuard | current paid request and selected route requirements |
| `integrations/cloudflare/paid-mcp-xguard.ts` | official MCP payment middleware | current paid tool call |
| Python FastAPI / Go Gin examples | official language facilitator client | current payload and requirements |
| WordPress connector | Automattic X402FacilitatorClient configured with XGuard URL | caller package constructs its own envelope; plugin does not implement a direct fetch |
| `apps/relay/src/paid-agent-entry.js` normal execution | configured HTTPFacilitatorClient, currently xpay | locally validated signed quote, full payload and requirements |
| Same module, reconciliation alarm | configured HTTPFacilitatorClient | full payload/requirements persisted in PaidGatewayState Durable Object |
| `apps/reconcile/src/index.js` | configured CDP or fallback facilitator | official resource-server middleware |
| `apps/relay/src/control-plane.js` → `gateway.js` → `index.js` | internal handler delegation then configured upstream `/settle` | canonical complete envelope plus fresh verification |
| `apps/relay/test/settlement-safety.mjs` | local Worker handler invocation | fixture payload; not a production HTTP request |

No application source contains a direct
`fetch("https://api.xguardgate.com/settle", ...)` self-call. Public SDK clients
are expected to call XGuard's facilitator over HTTP; trusted context is rebuilt
at the receiving boundary. The standalone reconciliation product uses its own
configured facilitator. Current paid outcome execution uses xpay directly,
not XGuard's public compatibility relay.

## Verification

`node --test apps/relay/test/payment-context.mjs` runs the real canonical handler
in a fresh Node Worker isolate for each request. Only simulated durable storage
survives. It exercises the official HTTP facilitator client with real EIP-712
signatures, direct settle without prior verify, normalization, replay, altered
context, invalid signatures, forged client trust fields, verifier outage, and
the existing binding/firewall checks. Settlement is simulated; there is no
funded wallet or onchain payment in these tests.

`scripts/verify-settlement-context.mjs` probes production with missing context
and a deliberately invalid signature. A complete envelope must pass structural
validation, reach verification, and be rejected before settlement. Neither probe
is a paying customer or real payment.

Primary SDK envelope source:
https://github.com/x402-foundation/x402/blob/main/typescript/packages/core/src/http/httpFacilitatorClient.ts
