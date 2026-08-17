# XGuard quickstart

XGuard production runs at:

- **Gateway:** `https://xguardgate.com`
- **Billing:** prepaid Base mainnet native USDC
- **Model:** pay per successful execution

XGuard is not limited to x402. The production gateway can meter model calls, tool calls, source discovery, analysis, security inspection, x402 verification, and finalized x402 settlement.

## 1. Free readiness and discovery

These calls are free:

```bash
curl https://xguardgate.com/
curl https://xguardgate.com/healthz
curl https://xguardgate.com/readyz
curl https://xguardgate.com/supported
curl https://xguardgate.com/status
```

MCP `server/discover`, `tools/list`, `ping`, and `xguard_status` are also free. Execution and value-producing MCP tools are billable.

## 2. Register a merchant

```bash
curl -sS -X POST https://xguardgate.com/v1/register \
  -H 'Content-Type: application/json' \
  --data '{"name":"my-service"}'
```

Save the returned API key:

```bash
export XGUARD_URL=https://xguardgate.com
export XGUARD_API_KEY='xg_live_...'
```

Do not commit the key.

## 3. Fund the prepaid service balance

Create a top-up intent:

```bash
curl -sS -X POST "$XGUARD_URL/v1/topups/intents" \
  -H "Authorization: Bearer $XGUARD_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"amountUsd":"1.00"}'
```

Send exactly the returned native Base USDC amount to the returned treasury address, then claim it:

```bash
curl -sS -X POST "$XGUARD_URL/v1/topups/claim" \
  -H "Authorization: Bearer $XGUARD_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"claimToken":"YOUR_CLAIM_TOKEN","transactionHash":"0xYOUR_TX_HASH"}'
```

Check the balance:

```bash
curl -sS "$XGUARD_URL/v1/balance" \
  -H "Authorization: Bearer $XGUARD_API_KEY"
```

Top-ups are prepaid service liabilities, not earned XGuard revenue.

## 4. Use the Universal Gateway

### Model execution

XGuard supports BYOK proxy execution. The caller supplies its upstream provider key and XGuard meters the successful gateway event separately.

Example OpenAI proxy shape:

```bash
curl -sS -X POST "$XGUARD_URL/v1/gateway/proxy/openai/v1/responses" \
  -H "Authorization: Bearer $XGUARD_API_KEY" \
  -H "X-XGuard-Upstream-Key: $OPENAI_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"model":"gpt-5","input":"hello"}'
```

Equivalent provider routes exist for the providers exposed by `/v1/gateway/capabilities`.

### Source discovery

```bash
curl -sS -X POST "$XGUARD_URL/v1/gateway/sources/search" \
  -H "Authorization: Bearer $XGUARD_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"query":"weather API"}'
```

### Analysis

```bash
curl -sS -X POST "$XGUARD_URL/v1/gateway/analyze" \
  -H "Authorization: Bearer $XGUARD_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"candidates":[{"provider":"a","latencyMs":100,"costMicroUsd":1000,"errorRateBps":50,"qualityBps":9000},{"provider":"b","latencyMs":80,"costMicroUsd":1200,"errorRateBps":100,"qualityBps":9300}]}'
```

### Security inspection

```bash
curl -sS -X POST "$XGUARD_URL/v1/gateway/security/inspect" \
  -H "Authorization: Bearer $XGUARD_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"targetUrl":"https://example.com","method":"POST","headerNames":["authorization"]}'
```

Successful calls return `X-XGuard-Fee-Micro-Usd` and `X-XGuard-Accounting` response headers.

## 5. MCP billing boundary

The remote MCP server remains discoverable without payment, but execution is not free.

Free:

- `server/discover`
- `tools/list`
- `ping`
- `xguard_status`

Billable:

- `xguard_discover`
- `xguard_resource_details`
- future execution tools unless explicitly marked free

Billable MCP `tools/call` requests require the merchant bearer credential and sufficient prepaid service balance. Source-oriented MCP tools use the configured SOURCE fee.

## 6. x402 remains one gateway, not the business dependency

Existing x402 v2 resource servers can still point their facilitator client at XGuard:

```ts
import { HTTPFacilitatorClient } from "@x402/core/http";

const createAuthHeaders = async () => {
  const headers = {
    Authorization: `Bearer ${process.env.XGUARD_API_KEY!}`,
  };
  return {
    verify: headers,
    settle: headers,
    supported: headers,
    bazaar: headers,
  };
};

const facilitatorClient = new HTTPFacilitatorClient({
  url: process.env.XGUARD_URL ?? "https://xguardgate.com",
  createAuthHeaders,
});
```

Mainnet x402 verification is a separately metered successful execution. A successful finalized settlement is also billed at the settlement fee. Settlement revenue is recognized only after independent Base USDC finality.

## Current production prices

| Event                           |     Fee |
| ------------------------------- | ------: |
| Model proxy                     | $0.0001 |
| Tool proxy                      | $0.0002 |
| x402 verify                     | $0.0002 |
| Source search / MCP source tool | $0.0010 |
| Security inspect                | $0.0010 |
| Analysis                        | $0.0020 |
| Finalized x402 settlement       | $0.0020 |

See `BILLING.md` for accounting invariants and failure semantics.
