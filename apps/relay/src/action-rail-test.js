import test from "node:test";
import assert from "node:assert/strict";
import actionRail from "./action-rail.js";

test("Action Rail publishes the protocol-neutral execution contract", async () => {
  const response = await actionRail.fetch(new Request("https://api.xguardgate.com/v1/actions"), { ACTION_EXECUTION_CREDITS: "1" });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.name, "XGuard Action Rail");
  assert.equal(data.role, "protocol-neutral execution control plane for AI side effects");
  assert.equal(data.permit, "POST https://xguardgate.com/api/v1/actions/permits");
  assert.equal(data.execute, "POST https://xguardgate.com/api/v1/actions/execute");
  assert.equal(data.credits_per_successful_execution, 1);
  assert.ok(data.protocols.includes("mpp"));
  assert.ok(data.protocols.includes("ap2"));
  assert.ok(data.protocols.includes("mcp"));
});

test("Action Rail pricing charges only successful execution", async () => {
  const response = await actionRail.fetch(new Request("https://api.xguardgate.com/v1/actions/pricing"), { ACTION_EXECUTION_CREDITS: "1" });
  const data = await response.json();
  assert.equal(data.credits_per_successful_execution, 1);
  assert.equal(data.failed_executions, "free");
  assert.equal(data.ambiguous_executions, "free");
});

test("Action Rail blocks private execution targets before billing", async () => {
  const response = await actionRail.fetch(new Request("https://api.xguardgate.com/v1/actions/permits", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target: "https://127.0.0.1/admin", method: "POST", action: "delete" }),
  }), {});
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "public_https_target_required");
});

test("Action Rail requires the dedicated XGuard billing key", async () => {
  const response = await actionRail.fetch(new Request("https://api.xguardgate.com/v1/actions/permits", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target: "https://example.com/orders", method: "POST", action: "purchase", request_body: { sku: "A" } }),
  }), {});
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "xguard_key_required");
});

test("Action Rail ignores unrelated paths", async () => {
  const response = await actionRail.fetch(new Request("https://api.xguardgate.com/not-an-action"), {});
  assert.equal(response, null);
});
