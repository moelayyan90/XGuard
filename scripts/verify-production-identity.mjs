const SITE = "https://xguardgate.com";
const API = "https://api.xguardgate.com";
const VERSION = "5.0.2";
const NAME = "XGuard Secretless Agent Gateway";

function fail(message) { throw new Error(message); }

async function getJson(url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000), ...options });
  if (!response.ok) fail(`${url}: HTTP ${response.status}`);
  return { response, body: await response.json() };
}

const root = await getJson(`${API}/`);
if (root.body.name !== NAME || root.body.version !== VERSION || root.body.primary_product !== "Secretless Egress") fail("API root has stale canonical identity");
if (root.response.headers.get("x-xguard-version") !== VERSION) fail("API root has stale version header");

const openapi = await getJson(`${API}/openapi.json`);
if (openapi.body.info?.title !== NAME || openapi.body.info?.version !== VERSION) fail("OpenAPI has stale canonical identity");
for (const path of ["/v1/egress", "/v1/egress/fetch", "/v1/proof", "/verify", "/settle"]) {
  if (!openapi.body.paths?.[path]) fail(`OpenAPI is missing ${path}`);
}

const plugin = await getJson(`${API}/.well-known/ai-plugin.json`);
if (plugin.body.name_for_human !== NAME || plugin.body.xguard?.product_version !== VERSION || plugin.body.xguard?.primary_product !== "Secretless Egress") fail("AI plugin has stale product taxonomy");
if (plugin.body.xguard?.component_versions?.x402 !== "5.0.1") fail("AI plugin does not distinguish the x402 compatibility component version");

const agent = await getJson(`${API}/.well-known/agent-card.json`);
if (!(agent.response.headers.get("content-type") || "").includes("application/a2a+json")) fail("Agent Card media type is wrong");
if (agent.body.name !== NAME || agent.body.version !== VERSION || !agent.body.skills?.some(skill => skill.id === "xguard-secretless-egress")) fail("Agent Card has stale identity or missing Secretless Egress skill");

const initialize = await getJson(`${API}/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "xguard-production-verifier", version: "1.0.0" } } }),
});
if (initialize.body.result?.serverInfo?.name !== "xguard-secretless-agent-gateway" || initialize.body.result?.serverInfo?.version !== VERSION) fail("MCP initialize has stale identity");

const tools = await getJson(`${API}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) });
const names = new Set((tools.body.result?.tools || []).map(tool => tool.name));
for (const name of ["xguard_secretless_egress", "xguard_egress_fetch", "xguard_proofrail", "xguard_verify_proof", "xguard_action_rail", "xguard_facilitator", "xguard_route"]) if (!names.has(name)) fail(`MCP is missing ${name}`);

const home = await fetch(`${SITE}/`, { signal: AbortSignal.timeout(12_000) });
const homeText = await home.text();
if (!home.ok || !homeText.includes("Secretless Agent") || home.headers.get("x-xguard-version") !== VERSION) fail("Homepage has stale identity");

const www = await fetch("https://www.xguardgate.com/connect?verification=1", { redirect: "manual", signal: AbortSignal.timeout(12_000) });
if (www.status !== 308 || www.headers.get("location") !== `${SITE}/connect?verification=1`) fail("www canonical redirect is not active");

console.log(JSON.stringify({ ok: true, name: NAME, version: VERSION, mcp_tools: names.size, www_redirect: 308 }));
