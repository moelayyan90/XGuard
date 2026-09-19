import test from "node:test";
import assert from "node:assert/strict";
import { verifyAgentUsage } from "./verify-agent-token-usage.mjs";
import app from "../apps/relay/src/canonical-entry.js";

test("safe production verifier checks both host dispatches and never supplies credentials", async () => {
  const requests = [];
  const checks = await verifyAgentUsage({ expectedTag: "git-fixture", fetcher: (url, init) => {
    const request = new Request(url, init); requests.push(request);
    assert.equal(request.headers.get("authorization"), null); assert.equal(request.headers.get("x-xguard-key"), null);
    return app.fetch(request, { CF_VERSION_METADATA: { tag: "git-fixture" } }, {});
  } });
  assert.equal(checks.length, 2); assert.ok(checks.every(check => check.status === 401 && !check.usage_written));
  assert.equal(requests.filter(request => request.method === "POST").length, 2);
});
for (const status of [200, 302, 404, 429, 500, 503]) test(`safe verifier refuses HTTP ${status} as proof of a working route`, async () => {
  await assert.rejects(verifyAgentUsage({ fetcher: async () => Response.json({ accepted: false, error: { code: "tenant_identity_required" } }, { status }) }), /expected explicit/);
});
