import test from "node:test";
import assert from "node:assert/strict";
import product from "./product-entry.js";

test("product entry rewrites MCP initialize to Secretless Gateway identity", async () => {
  const request = new Request("https://api.xguardgate.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "product-entry-test", version: "1.0.0" },
      },
    }),
  });
  const response = await product.fetch(request, {});
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.result?.serverInfo?.name, "xguard-secretless-agent-gateway");
  assert.equal(data.result?.serverInfo?.version, "5.0.1");
  assert.match(String(data.result?.instructions || ""), /reusable upstream API credentials/i);
  assert.equal(response.headers.get("x-xguard-canonical-mcp"), "https://xguardgate.com/api/mcp");
});
