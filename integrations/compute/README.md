# Compute quick start

Check `https://api.xguardgate.com/v1/compute/health` first. An unconfigured
provider returns an honest 503 and never asks for payment. Only model IDs in the
eligible catalog and reviewed GPU templates can execute.

## cURL: quote, then execute the exact offer

Create `request.json` with a currently eligible model ID:

```json
{
  "model": "<eligible-model-id>",
  "messages": [{"role":"user","content":"Explain gravity in one sentence."}],
  "max_tokens": 64,
  "max_amount_atomic": "10000",
  "accept_provider_terms": true
}
```

```bash
curl -sS -D quote.headers https://api.xguardgate.com/v1/inference/quote \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: my-stable-compute-request' \
  --data-binary @request.json -o quote.json
```

Use an official x402 v2 wallet client to sign `quote.json`'s `payment` object
within your 10000-atomic budget (0.01 USDC). Save its Base64 payload to
`payment-signature.txt` and the returned compact quote to `quote-token.txt`.
Protect these files. cURL alone cannot authorize a USDC transfer.

```bash
curl -sS https://api.xguardgate.com/v1/inference/execute \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: my-stable-compute-request' \
  -H "X-XGuard-Quote: $(cat quote-token.txt)" \
  -H "Payment-Signature: $(cat payment-signature.txt)" \
  --data-binary @request.json
```

After uncertainty, keep that exact authorization and recover
`GET /v1/compute/executions/<quote_id>` with the original `X-XGuard-Quote`. Do not
start another purchase to retry this one. A private quote grants result access.

## JavaScript

The runnable `inference.mjs` uses the dependency-free `sdk/compute.js` helper and
the official x402/viem payer. Install its pinned dependencies with
`npm install --prefix integrations/compute --no-audit --no-fund`, then run
`node integrations/compute/inference.mjs`. Set `XGUARD_BUYER_PRIVATE_KEY`,
`XGUARD_BUYER_MAX_ATOMIC` and `XGUARD_COMPUTE_MODEL` in your own local environment.
Never put a buyer private key in a browser, repository, issue or public log.
The example saves the original prepared authorization before submission,
performs no automatic replacement purchase and verifies the result receipt.

## Python

`inference.py` uses the standard library and `eth-account` to sign the exact Base
USDC TransferWithAuthorization typed data. It uses the same explicit budget,
private local environment settings and recovery file. It returns the signed
receipt without asserting signature verification; use the JS verifier or an
ES256 JWS verifier and compare the signed canonical response digest before
trusting delivery. Its saved authorization remains available for an exact retry
if the first process ended before sending the payment.

## MCP / A2A

Connect Streamable HTTP MCP at `https://xguardgate.com/mcp`. Discover
`list_compute_providers`, `list_models`, `compute_health`, `quote_inference`,
`execute_inference`, `quote_gpu_job`, `execute_gpu_job`, `get_execution_receipt`.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "quote_inference",
    "arguments": {
      "model": "<eligible-model-id>",
      "input": "Explain gravity in one sentence.",
      "max_tokens": 64,
      "max_amount_atomic": "10000",
      "accept_provider_terms": true,
      "idempotency_key": "my-stable-compute-request"
    }
  }
}
```

For paid execution forward `Payment-Signature` and `X-XGuard-Quote` on the MCP
request; the signed payment resource stays the canonical HTTP execute URL.
A2A uses `SendMessage` with `{ "action":"xguard.compute.quote_inference",
"input":{...same arguments...} }` in the message's data part. Discovery is free.

For activation, exact policy requirements and remaining limits see
[the production activation record](../../docs/operations/compute-gateway-20261115.md).
