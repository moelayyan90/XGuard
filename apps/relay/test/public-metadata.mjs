import metadata from "../src/public-metadata.js";

const expected = "5.0.1";

async function get(path, method = "GET") {
  const response = await metadata.fetch(new Request(`https://api.xguardgate.com${path}`, { method }));
  if (!(response instanceof Response)) throw new Error(`${path}: no response`);
  if (response.status !== 200) throw new Error(`${path}: status ${response.status}`);
  if (response.headers.get("x-xguard-control-plane") !== expected) throw new Error(`${path}: wrong version header`);
  if (!String(response.headers.get("strict-transport-security") || "").includes("max-age=31536000")) throw new Error(`${path}: HSTS missing`);
  return response;
}

for (const path of ["/architecture", "/v1/protocols", "/.well-known/xguard.json"]) {
  const response = await get(path);
  const body = await response.json();
  if (body.version !== expected || body.product_version !== expected) throw new Error(`${path}: stale product version`);
  if (body.name !== "XGuard High-Velocity x402 Facilitator") throw new Error(`${path}: stale identity`);
  if (body.facilitator_url !== "https://api.xguardgate.com") throw new Error(`${path}: wrong facilitator URL`);
}

const protocols = await (await get("/v1/protocols")).json();
if (protocols.x402?.version !== 2) throw new Error("protocol manifest: x402 v2 missing");
if (protocols.x402?.settlement_ambiguous_fail_closed !== true) throw new Error("protocol manifest: fail-closed missing");
if (protocols.x402?.settlement_transport_failover !== "reconciliation-gated") throw new Error("protocol manifest: settlement failover policy wrong");

const architecture = await (await get("/architecture")).json();
if (architecture.architecture?.base_usdc_reconciliation !== true) throw new Error("architecture: Base reconciliation missing");
if (architecture.architecture?.signed_payment_recipient_mutation !== false) throw new Error("architecture: recipient mutation contract wrong");

for (const path of ["/architecture", "/v1/protocols", "/.well-known/xguard.json"]) {
  const response = await get(path, "HEAD");
  if ((await response.text()) !== "") throw new Error(`${path}: HEAD returned a body`);
}

const miss = await metadata.fetch(new Request("https://api.xguardgate.com/not-metadata"));
if (miss !== null) throw new Error("metadata layer intercepted an unrelated path");

console.log(JSON.stringify({ ok: true, version: expected, surfaces: 3 }));
