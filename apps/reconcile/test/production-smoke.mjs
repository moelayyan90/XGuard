import test from "node:test";
import assert from "node:assert/strict";
import entry from "../src/discovery-entry.js";
import { runReconcileSmoke } from "../scripts/production-smoke.mjs";

const tag = "git-0123456789ab";
const treasury = "0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07";
const env = { XGUARD_TREASURY_USDC_ADDRESS: treasury, CF_VERSION_METADATA: { tag } };

test("deployment revision header covers public, error and challenge responses", async () => {
  for (const [path, status, settings] of [["/docs", 200, env], ["/unknown", 404, env], ["/v1/reconcile", 402, env],
    ["/v1/reconcile?from=invalid", 400, env], ["/v1/reconcile", 503, { CF_VERSION_METADATA: { tag } }]]) {
    const response = await entry.fetch(new Request(`https://reconcile.xguardgate.com${path}`), settings, {});
    assert.equal(response.status, status);
    assert.equal(response.headers.get("x-xguard-worker-version-tag"), tag);
    await response.text();
  }
});

test("smoke rejects missing revision, stale rollout, changed price and non-402 protected routes", async () => {
  await assert.rejects(runReconcileSmoke({ expectedTag: "" }), /Expected deployed git tag/);
  let attempts = 0;
  await assert.rejects(runReconcileSmoke({ expectedTag: tag, pause: async () => {}, fetchImpl: async () => {
    attempts++; return Response.json({}, { headers: { "x-xguard-worker-version-tag": "git-ffffffffffff" } });
  } }), /not from the tested deployment/);
  assert.equal(attempts, 8);
  const responseFor = async (url, init) => entry.fetch(new Request(url, init), env, {});
  for (const fault of ["price", "protected"]) {
    await assert.rejects(runReconcileSmoke({ expectedTag: tag, fetchImpl: async (url, init) => {
      if (fault === "price" && url.endsWith("/healthz")) return Response.json({ status: "ok", payment_ready: true, network: "eip155:8453", price: "$0" }, { headers: { "x-xguard-worker-version-tag": tag } });
      if (fault === "protected" && url.endsWith("/v1/reconcile")) return Response.json({}, { headers: { "x-xguard-worker-version-tag": tag } });
      return responseFor(url, init);
    } }));
  }
});
