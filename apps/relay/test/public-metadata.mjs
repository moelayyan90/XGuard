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
if (protocols.discovery?.ai_plugin !== "https://api.xguardgate.com/.well-known/ai-plugin.json") throw new Error("protocol manifest: ai-plugin discovery missing");

const architecture = await (await get("/architecture")).json();
if (architecture.architecture?.base_usdc_reconciliation !== true) throw new Error("architecture: Base reconciliation missing");
if (architecture.architecture?.signed_payment_recipient_mutation !== false) throw new Error("architecture: recipient mutation contract wrong");

const plugin = await (await get("/.well-known/ai-plugin.json")).json();
if (plugin.schema_version !== "v1") throw new Error("ai-plugin: schema version missing");
if (plugin.name_for_human !== "XGuard High-Velocity x402 Facilitator") throw new Error("ai-plugin: stale identity");
if (plugin.api?.type !== "openapi" || plugin.api?.url !== "https://api.xguardgate.com/openapi.json") throw new Error("ai-plugin: OpenAPI link wrong");
if (plugin.xguard?.version !== expected || plugin.xguard?.x402_version !== 2) throw new Error("ai-plugin: product version wrong");
if (plugin.xguard?.mcp_url !== "https://api.xguardgate.com/mcp") throw new Error("ai-plugin: MCP link wrong");
if (plugin.auth?.type !== "none") throw new Error("ai-plugin: auth declaration wrong");

for (const path of ["/architecture", "/v1/protocols", "/.well-known/xguard.json", "/.well-known/ai-plugin.json"]) {
  const response = await get(path, "HEAD");
  if ((await response.text()) !== "") throw new Error(`${path}: HEAD returned a body`);
}

const miss = await metadata.fetch(new Request("https://api.xguardgate.com/not-metadata"));
if (miss !== null) throw new Error("metadata layer intercepted an unrelated path");

console.log(JSON.stringify({ ok: true, version: expected, surfaces: 4 }));
