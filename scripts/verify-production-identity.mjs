const SITE = "https://xguardgate.com";
const API = "https://api.xguardgate.com";
const VERSION = "5.1.0";
const NAME = "XGuard Universal Paid AI Agent + Secretless Gateway";

function fail(message) { throw new Error(message); }

async function getJson(url, options = {}) {
  const requestHeaders = new Headers(options.headers || {});
  requestHeaders.set("x-xguard-traffic-class", "synthetic");
  requestHeaders.set("user-agent", "xguard-production-verifier/5.1.0");
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000), ...options, headers: requestHeaders });
  if (!response.ok) fail(`${url}: HTTP ${response.status}`);
  return { response, body: await response.json() };
}

const root = await getJson(`${API}/`);
if (root.body.name !== NAME || root.body.version !== VERSION || root.body.primary_product !== "Universal Paid AI Agent + Secretless Gateway") fail("API root has stale canonical identity");
if (root.response.headers.get("x-xguard-version") !== VERSION) fail("API root has stale version header");

const openapi = await getJson(`${API}/openapi.json`);
if (openapi.body.info?.title !== NAME || openapi.body.info?.version !== VERSION) fail("OpenAPI has stale canonical identity");
for (const path of ["/v1/capabilities", "/v1/pricing", "/v1/pricing/quote", "/v1/tools/web.fetch", "/v1/payment/readiness", "/v1/egress", "/v1/egress/fetch", "/v1/proof", "/verify", "/settle"]) {
  if (!openapi.body.paths?.[path]) fail(`OpenAPI is missing ${path}`);
}
if (!openapi.body.paths["/v1/preflight"]?.post) fail("OpenAPI is missing the guarded preflight path");
if (!Array.isArray(openapi.body.paths["/v1/pricing/quote"].post?.requestBody?.content?.["application/json"]?.schema?.oneOf)) fail("OpenAPI is missing tolerant quote request envelopes");
if (openapi.body.paths["/v1/tools/web.fetch"].post?.["x-xguard-payment-flow"]?.payment_required !== true) fail("OpenAPI does not make paid execution mandatory");

const plugin = await getJson(`${API}/.well-known/ai-plugin.json`);
if (plugin.body.name_for_human !== NAME || plugin.body.xguard?.product_version !== VERSION || plugin.body.xguard?.primary_product !== "Universal Paid AI Agent + Secretless Gateway") fail("AI plugin has stale product taxonomy");
if (plugin.body.xguard?.component_versions?.x402 !== VERSION) fail("AI plugin has a stale x402 component version");

const agent = await getJson(`${API}/.well-known/agent-card.json`);
if (!(agent.response.headers.get("content-type") || "").includes("application/a2a+json")) fail("Agent Card media type is wrong");
if (agent.body.name !== NAME || agent.body.version !== VERSION || !agent.body.skills?.some(skill => skill.id === "xguard-paid-web-fetch") || !agent.body.skills?.some(skill => skill.id === "xguard-secretless-egress")) fail("Agent Card has stale identity or missing paid/secretless skills");
if (!agent.body.capabilities?.extensions?.some(extension => extension.params?.challenge_status === 402 && extension.params?.settlement_before_execution === true)) fail("Agent Card is missing the automated x402 transition");
if (agent.body.supportedInterfaces?.[0]?.protocolVersion !== "1.0.0") fail("Agent Card does not advertise A2A 1.0.0");

const oauth = await getJson(`${API}/.well-known/oauth-protected-resource/mcp`);
if (oauth.body.resource !== `${API}/mcp` || oauth.body["x-xguard-authentication"]?.required !== false || oauth.body["x-xguard-authentication"]?.oauth_supported !== false) fail("OAuth protected-resource metadata is stale or misleading");

const initialize = await getJson(`${API}/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "xguard-production-verifier", version: "1.0.0" } } }),
});
if (initialize.body.result?.serverInfo?.name !== "xguard-universal-paid-secretless-gateway" || initialize.body.result?.serverInfo?.version !== VERSION) fail("MCP initialize has stale identity");

const tools = await getJson(`${API}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) });
const names = new Set((tools.body.result?.tools || []).map(tool => tool.name));
for (const name of ["xguard.capabilities", "xguard.preflight", "xguard.pricing.quote", "xguard.web.fetch", "xguard_secretless_egress", "xguard_egress_fetch", "xguard_proofrail", "xguard_verify_proof", "xguard_action_rail", "xguard_facilitator", "xguard_route"]) if (!names.has(name)) fail(`MCP is missing ${name}`);
const paidTool = (tools.body.result?.tools || []).find(tool => tool.name === "xguard.web.fetch");
if (paidTool?._meta?.["xguard/payment"]?.required !== true || paidTool?._meta?.["xguard/payment"]?.settlement_before_execution !== true) fail("MCP does not make the paid transition explicit");
const preflightTool = (tools.body.result?.tools || []).find(tool => tool.name === "xguard.preflight");
if (preflightTool?._meta?.["xguard/next"]?.quote_url !== `${API}/v1/pricing/quote`) fail("MCP preflight does not expose the canonical quote transition");

const capabilities = await getJson(`${API}/v1/capabilities`);
const actual = new Map(capabilities.body.tools?.map(tool => [tool.id, tool]));
if (actual.get("xguard.web.fetch")?.available !== true || actual.get("xguard.web.search")?.available !== false || actual.get("xguard.ai.generate")?.available !== false) fail("Capabilities advertise unavailable connectors");

const pricing = await getJson(`${API}/v1/pricing`);
if (pricing.body.quote_request?.canonical_shape?.url !== "https://example.com/" || pricing.body.paid_flow?.first_response !== "HTTP 402 with Payment-Required and a signed offer") fail("Pricing discovery is missing the canonical automated quote flow");

const preflight = await getJson(`${API}/v1/preflight`);
if (preflight.body.name !== "xguard.preflight" || preflight.body.target_contacted !== false || preflight.body.guidance?.next?.includes("/v1/pricing/quote") !== true) fail("Preflight discovery is stale or missing the canonical next step");

const toolsManifest = await getJson(`${API}/.well-known/xguard-tools.json`);
if (toolsManifest.body.execution_chokepoint?.tool !== "xguard.web.fetch" || toolsManifest.body.execution_chokepoint?.settlement_before_execution !== true || !Array.isArray(toolsManifest.body.tools)) fail("XGuard tool manifest is stale or missing the guarded execution choke point");

const payment = await getJson(`${API}/.well-known/payment-manifest`);
if (payment.body.x402_version !== 2 || payment.body.resources?.[0]?.payment_identifier_required !== true || payment.body.resources?.[0]?.settlement_before_execution !== true) fail("Payment manifest is stale or unsafe");

const paymentReadiness = await getJson(`${API}/v1/payment/readiness`);
if (paymentReadiness.body.production?.environment !== "production" || paymentReadiness.body.production?.network !== "eip155:8453" || paymentReadiness.body.test?.environment !== "test" || paymentReadiness.body.test?.network !== "eip155:84532" || paymentReadiness.body.test?.revenue !== false) fail("Production and test payment rails are not isolated");

const syntheticHeaders = { "x-xguard-traffic-class": "synthetic", "user-agent": "xguard-production-verifier/5.1.0" };
const home = await fetch(`${SITE}/`, { headers: syntheticHeaders, signal: AbortSignal.timeout(12_000) });
const homeText = await home.text();
if (!home.ok || !homeText.includes("Universal Paid AI Agent + Secretless Gateway") || home.headers.get("x-xguard-version") !== VERSION) fail("Homepage has stale identity");

const www = await fetch("https://www.xguardgate.com/connect?verification=1", { headers: syntheticHeaders, redirect: "manual", signal: AbortSignal.timeout(12_000) });
if (www.status !== 308 || www.headers.get("location") !== `${SITE}/connect?verification=1`) fail("www canonical redirect is not active");

console.log(JSON.stringify({ ok: true, name: NAME, version: VERSION, mcp_tools: names.size, www_redirect: 308 }));
