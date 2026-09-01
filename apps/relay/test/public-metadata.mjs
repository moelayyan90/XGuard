import metadata from "../src/public-metadata.js";

const expected = "5.1.0";
const identity = "XGuard Universal Paid AI Agent + Secretless Gateway";

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
  if (body.name !== identity) throw new Error(`${path}: stale identity`);
  if (!body.secretless_egress?.manifest || !body.secretless_egress?.fetch) throw new Error(`${path}: secretless egress missing`);
}

const protocols = await (await get("/v1/protocols")).json();
if (protocols.x402?.version !== 2) throw new Error("protocol manifest: x402 v2 missing");
if (protocols.x402?.settlement_ambiguous_fail_closed !== true) throw new Error("protocol manifest: x402 fail-closed missing");
if (protocols.secretless_egress?.providers?.includes("stripe") !== true) throw new Error("protocol manifest: Stripe egress preset missing");
if (protocols.discovery?.egress_manifest !== "https://api.xguardgate.com/.well-known/xguard-egress.json") throw new Error("protocol manifest: egress discovery missing");
if (protocols.discovery?.ai_plugin !== "https://api.xguardgate.com/.well-known/ai-plugin.json") throw new Error("protocol manifest: ai-plugin discovery missing");
if (protocols.discovery?.capabilities !== "https://api.xguardgate.com/v1/capabilities" || protocols.discovery?.payment_manifest !== "https://api.xguardgate.com/.well-known/payment-manifest") throw new Error("protocol manifest: paid discovery missing");

const architecture = await (await get("/architecture")).json();
if (architecture.architecture?.billing_before_credential_release !== true) throw new Error("architecture: pre-egress billing missing");
if (architecture.architecture?.automatic_credential_redirect_forwarding !== false) throw new Error("architecture: redirect safety wrong");
if (architecture.architecture?.automatic_egress_replay !== false) throw new Error("architecture: replay policy wrong");

const plugin = await (await get("/.well-known/ai-plugin.json")).json();
if (plugin.schema_version !== "v1") throw new Error("ai-plugin: schema version missing");
if (plugin.name_for_human !== identity) throw new Error("ai-plugin: stale identity");
if (plugin.api?.type !== "openapi" || plugin.api?.url !== "https://api.xguardgate.com/openapi.json") throw new Error("ai-plugin: OpenAPI link wrong");
if (plugin.xguard?.version !== expected || !plugin.xguard?.egress_manifest || !plugin.xguard?.capabilities || !plugin.xguard?.payment_manifest) throw new Error("ai-plugin: paid/egress version wrong");
if (plugin.xguard?.mcp_url !== "https://api.xguardgate.com/mcp") throw new Error("ai-plugin: MCP link wrong");

for (const path of ["/architecture", "/v1/protocols", "/.well-known/xguard.json", "/.well-known/ai-plugin.json"]) {
  const response = await get(path, "HEAD");
  if ((await response.text()) !== "") throw new Error(`${path}: HEAD returned a body`);
}

const miss = await metadata.fetch(new Request("https://api.xguardgate.com/not-metadata"));
if (miss !== null) throw new Error("metadata layer intercepted an unrelated path");
console.log(JSON.stringify({ ok: true, version: expected, identity, surfaces: 4 }));
