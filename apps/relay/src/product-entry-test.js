import test from "node:test";
import assert from "node:assert/strict";
import product from "./product-entry.js";

function mcp(method, params = {}, id = 1) {
  return new Request("https://api.xguardgate.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

test("product entry rewrites MCP initialize to Secretless Gateway identity", async () => {
  const request = mcp("initialize", {
    protocolVersion: "2026-07-28",
    capabilities: {},
    clientInfo: { name: "product-entry-test", version: "1.0.0" },
  });
  const response = await product.fetch(request, {});
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.result?.serverInfo?.name, "xguard-secretless-agent-gateway");
  assert.equal(data.result?.serverInfo?.version, "5.0.1");
  assert.match(String(data.result?.instructions || ""), /reusable upstream API credentials/i);
  assert.match(String(data.result?.instructions || ""), /Hosted Gate/i);
  assert.equal(response.headers.get("x-xguard-canonical-mcp"), "https://api.xguardgate.com/mcp");
});

test("product entry publishes Hosted Gate as a discoverable MCP tool", async () => {
  const response = await product.fetch(mcp("tools/list"), {});
  assert.equal(response.status, 200);
  const data = await response.json();
  const tool = data.result?.tools?.find(item => item.name === "xguard_hosted_gate");
  assert.ok(tool);
  assert.equal(tool.annotations?.readOnlyHint, true);
  assert.equal(tool.annotations?.destructiveHint, false);
});

test("Hosted Gate MCP tool returns reverse-proxy integration contract", async () => {
  const response = await product.fetch(mcp("tools/call", { name: "xguard_hosted_gate", arguments: {} }, 3), {});
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.result?.structuredContent?.name, "XGuard Hosted Gate");
  assert.equal(data.result?.structuredContent?.endpoint, "https://api.xguardgate.com/v1/gate/authorize");
  assert.ok(data.result?.structuredContent?.gateways?.includes("Traefik ForwardAuth"));
});
