import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { validateDiscoveryExtension } from "@x402/extensions/bazaar";

const ORIGIN = "https://reconcile.xguardgate.com";
const NETWORK = "eip155:8453";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TREASURY = "0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07";
const QUERY = `?from=0x${"1".repeat(40)}&nonce=0x${"2".repeat(64)}`;

// Never prepare a payment authorization. These probes must not execute a paid
// reconciliation, submit a signature, or call a facilitator's verify/settle API.
export async function runReconcileSmoke({ fetchImpl = globalThis.fetch, expectedTag = process.env.EXPECTED_RECONCILE_TAG,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  assert.match(expectedTag || "", /^git-[0-9a-f]{12,40}$/, "Expected deployed git tag is required");
  let checks = 0;
  const get = (path, init = {}) => fetchImpl(`${ORIGIN}${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(10000),
    headers: { accept: "application/json", "user-agent": "XGuardReconcileSmoke/1.0", ...init.headers } });
  const revision = response => assert.equal(response.headers.get("x-xguard-worker-version-tag"), expectedTag, "Response is not from the tested deployment");
  let health;
  for (let attempt = 0; attempt < 8; attempt++) {
    health = await get("/healthz");
    if (health.headers.get("x-xguard-worker-version-tag") === expectedTag) break;
    await health.body?.cancel();
    if (attempt < 7) await pause(3000);
  }
  revision(health); assert.equal(health.status, 200);
  const status = await health.json();
  assert.equal(status.status, "ok"); assert.equal(status.payment_ready, true);
  assert.equal(status.network, NETWORK); assert.equal(status.price, "$0.002"); checks++;
  for (const path of ["/", "/docs", "/openapi.json", "/llms.txt", "/robots.txt", "/sitemap.xml"]) {
    const response = await get(path); revision(response); assert.equal(response.status, 200, path);
    assert.ok((await response.text()).length > 0); checks++;
  }
  const document = await get("/.well-known/x402.json"); revision(document); assert.equal(document.status, 200);
  const discovery = await document.json();
  assert.equal(discovery.x402Version, 2); assert.ok(discovery.resources[0].extensions.bazaar); checks++;
  const checkRequirements = required => {
    assert.equal(required.x402Version, 2);
    const accept = required.accepts[0];
    assert.equal(accept.scheme, "exact"); assert.equal(accept.amount, "2000"); assert.equal(accept.network, NETWORK);
    assert.equal(accept.asset.toLowerCase(), USDC.toLowerCase()); assert.equal(accept.payTo.toLowerCase(), TREASURY.toLowerCase());
  };
  checkRequirements(discovery.resources[0] && { x402Version: 2, accepts: discovery.resources[0].accepts });
  for (const path of ["/v1/reconcile", `/v1/reconcile${QUERY}`]) {
    const response = await get(path); revision(response); assert.equal(response.status, 402, path);
    const required = decodePaymentRequiredHeader(response.headers.get("payment-required")); checkRequirements(required);
    if (path.includes("?")) {
      assert.equal(required.resource.url, `${ORIGIN}/v1/reconcile`);
      assert.equal(validateDiscoveryExtension(required.extensions.bazaar).valid, true);
    }
    assert.doesNotMatch(await response.text(), /authorization_used|safe_to_retry_same_authorization/); checks++;
  }
  for (const [path, init, expected] of [
    ["/v1/reconcile?from=invalid", {}, 400],
    ["/v1/reconcile", { headers: { "payment-signature": "not-a-payment" } }, 400],
    ["/__reconcile_deployment_probe__", {}, 404],
    ["/v1/reconcile", { method: "HEAD" }, 404],
    ["/v1/reconcile", { method: "POST" }, 404]
  ]) {
    const response = await get(path, init); revision(response); assert.equal(response.status, expected, path);
    assert.equal(response.headers.has("payment-response"), false); await response.text(); checks++;
  }
  return { reconcile_production_smoke: "passed", revision: expectedTag, checks, payment_authorizations_submitted: 0, production_money_moved: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await runReconcileSmoke()));
