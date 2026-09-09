const SITE = "https://xguardgate.com";
const API = "https://api.xguardgate.com";
const VERSION = "5.1.0";
const NAME = "XGuard Universal Paid AI Agent + Secretless Gateway";
const DEPLOYMENT = process.env.DEPLOY_SHA || process.env.GITHUB_SHA || String(Date.now());

function freshDiscoveryUrl(url) {
  const target = new URL(url);
  target.searchParams.set("deployment_probe", DEPLOYMENT);
  return target.toString();
}

function fail(message) { throw new Error(message); }

async function getJson(url, options = {}) {
  const requestHeaders = new Headers(options.headers || {});
  requestHeaders.set("x-xguard-traffic-class", "synthetic");
  requestHeaders.set("user-agent", "xguard-production-verifier/5.1.0");
  requestHeaders.set("cache-control", "no-cache");
  const requestUrl = ["GET", "HEAD"].includes(options.method || "GET") ? freshDiscoveryUrl(url) : url;
  const response = await fetch(requestUrl, { signal: AbortSignal.timeout(12_000), ...options, headers: requestHeaders });
  if (!response.ok) fail(`${url}: HTTP ${response.status}`);
  return { response, body: await response.json() };
}

const root = await getJson(`${API}/`);
if (root.body.name !== NAME || root.body.version !== VERSION || root.body.primary_product !== "Universal Paid AI Agent + Secretless Gateway") fail("API root has stale canonical identity");
if (root.response.headers.get("x-xguard-version") !== VERSION) fail("API root has stale version header");

const openapi = await getJson(`${API}/openapi.json`);
if (openapi.body.info?.title !== NAME || openapi.body.info?.version !== VERSION) fail("OpenAPI has stale canonical identity");
for (const path of ["/v1/execute", "/v1/capabilities/{id}", "/v1/results/{payment_identifier}", "/v1/capabilities", "/v1/pricing", "/v1/pricing/quote", "/v1/tools/web.fetch", "/v1/payment/readiness", "/v1/egress", "/v1/egress/fetch", "/v1/proof", "/verify", "/settle"]) {
  if (!openapi.body.paths?.[path]) fail(`OpenAPI is missing ${path}`);
}
if (!openapi.body.paths["/v1/preflight"]?.post) fail("OpenAPI is missing the guarded preflight path");
if (!Array.isArray(openapi.body.paths["/v1/pricing/quote"].post?.requestBody?.content?.["application/json"]?.schema?.anyOf)) fail("OpenAPI is missing tolerant quote request envelopes");
if (openapi.body.paths["/v1/tools/web.fetch"].post?.["x-xguard-payment-flow"]?.payment_required !== true) fail("OpenAPI does not make paid execution mandatory");

const plugin = await getJson(`${API}/.well-known/ai-plugin.json`);
if (plugin.body.name_for_human !== NAME || plugin.body.xguard?.product_version !== VERSION || plugin.body.xguard?.primary_product !== "Universal Paid AI Agent + Secretless Gateway") fail("AI plugin has stale product taxonomy");
if (plugin.body.xguard?.component_versions?.x402 !== VERSION) fail("AI plugin has a stale x402 component version");

const agent = await getJson(`${API}/.well-known/agent-card.json`);
if (!(agent.response.headers.get("content-type") || "").includes("application/a2a+json")) fail("Agent Card media type is wrong");
if (agent.body.name !== NAME || agent.body.version !== VERSION || !(["extract-preview", "web-extraction", "product-offers", "feed-digest"].every(id => agent.body.skills?.some(skill => skill.id === id)))) fail("Agent Card has stale identity or missing executable outcome skills");
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
for (const name of ["xguard_discover", "xguard_execute", "xguard_get_result"]) if (!names.has(name)) fail(`MCP is missing ${name}`);
if (names.size !== 3) fail("Internal tools leaked into the primary catalog");
const paidTool = tools.body.result.tools.find(tool => tool.name === "xguard_execute");
if (paidTool?._meta?.["xguard/payment"]?.paid_capabilities?.length !== 3 || paidTool?._meta?.["xguard/payment"]?.settlement_before_execution !== true) fail("MCP does not make paid outcomes explicit");

const capabilities = await getJson(`${API}/v1/capabilities`);
const actual = new Map(capabilities.body.capabilities?.map(item => [item.id, item]));
for (const [id, amount] of [["extract-preview", "0"], ["web-extraction", "3000"], ["product-offers", "6000"], ["feed-digest", "2000"]]) {
  const item = actual.get(id);
  if (item?.availability !== "live" || item.pricing?.amount_atomic !== amount || !item.input_schema || !item.output_schema || item.execute_url !== `${API}/v1/execute`) fail(`Incomplete executable capability ${id}`);
  const detail = await getJson(`${API}/v1/capabilities/${id}`);
  if (detail.body.id !== id) fail(`Capability detail mismatch ${id}`);
}
if (actual.size !== 4) fail("Unexpected executable catalog");
const pricing = await getJson(`${API}/v1/pricing`);
if (pricing.body.execution_url !== `${API}/v1/execute` || pricing.body.capabilities?.length !== 4) fail("Pricing does not expose outcome execution");
const first = await getJson(root.body.first_result.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(root.body.first_result.body) });
if (first.body.ok !== true || first.body.cost.amount_atomic !== "0" || !first.body.result.document.text || first.body.result.network_calls !== 0) fail("An anonymous root client cannot reach a free result");
const outcome402 = await fetch(`${API}/v1/execute`, { method: "POST", headers: { "content-type": "application/json", "x-xguard-traffic-class": "synthetic" }, body: JSON.stringify({ intent: "Get a technology news digest" }), signal: AbortSignal.timeout(12000) });
const challenge = await outcome402.json();
if (outcome402.status !== 402 || challenge.accepts?.[0]?.amount !== "2000" || !outcome402.headers.get("x-xguard-quote") || !challenge.will_return) fail("The paid intent has no exact actionable price");

const preflight = await getJson(`${API}/v1/preflight`);
if (preflight.body.name !== "xguard.preflight" || preflight.body.target_contacted !== false || preflight.body.response?.next?.execution_url !== `${API}/v1/tools/web.fetch` || preflight.body.response?.next?.expected_first_status !== 402) fail("Preflight discovery is stale or missing the direct execution step");

const toolsManifest = await getJson(`${API}/.well-known/xguard-tools.json`);
if (toolsManifest.body.execution_chokepoint?.tool !== "xguard_execute" || toolsManifest.body.execution_chokepoint?.settlement_before_execution !== true || !Array.isArray(toolsManifest.body.tools)) fail("XGuard tool manifest is stale or missing the guarded execution choke point");

const payment = await getJson(`${API}/.well-known/payment-manifest`);
if (payment.body.x402_version !== 2 || payment.body.resources?.[0]?.payment_identifier_required !== true || payment.body.resources?.[0]?.settlement_before_execution !== true || payment.body.resources?.[0]?.first_call_creates_quote !== true) fail("Payment manifest is stale or unsafe");

const paymentReadiness = await getJson(`${API}/v1/payment/readiness`);
if (paymentReadiness.body.production?.environment !== "production" || paymentReadiness.body.production?.network !== "eip155:8453" || paymentReadiness.body.test?.environment !== "test" || paymentReadiness.body.test?.network !== "eip155:84532" || paymentReadiness.body.test?.revenue !== false) fail("Production and test payment rails are not isolated");

const direct = await fetch(`${API}/v1/tools/web.fetch`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-xguard-traffic-class": "synthetic", "user-agent": "xguard-production-verifier/5.1.0" },
  body: JSON.stringify({ url: "https://example.com/" }),
  signal: AbortSignal.timeout(12_000),
});
const directBody = await direct.json();
if (direct.status !== 402 || !direct.headers.get("payment-required") || !direct.headers.get("x-xguard-quote")) fail("Direct paid call did not create an actionable 402");
if (directBody.accepts?.[0]?.network !== "eip155:8453" || directBody.extensions?.xguard?.quote !== direct.headers.get("x-xguard-quote") || directBody.extensions?.xguard?.next?.action !== "sign_and_retry") fail("Direct paid 402 is incomplete or inconsistent");

const syntheticHeaders = { "x-xguard-traffic-class": "synthetic", "user-agent": "xguard-production-verifier/5.1.0" };
const home = await fetch(freshDiscoveryUrl(`${SITE}/`), { headers: syntheticHeaders, signal: AbortSignal.timeout(12_000) });
const homeText = await home.text();
if (!home.ok || !homeText.includes("Three sources.") || home.headers.get("x-xguard-version") !== VERSION) fail("Homepage has stale identity");
const tryPage = await fetch(freshDiscoveryUrl(`${SITE}/try`), { headers: syntheticHeaders, signal: AbortSignal.timeout(12_000) });
const tryText = await tryPage.text();
if (!tryPage.ok || !tryText.includes("Run free extraction") || !tryText.includes("/v1/execute")) fail("Live try page is missing the one-call payment path");

const developers = await fetch(freshDiscoveryUrl(`${SITE}/developers`), { headers: syntheticHeaders, signal: AbortSignal.timeout(12_000) });
const developersText = await developers.text();
if (!developers.ok || !developersText.includes("/install/vscode.json") || !developersText.includes("YOUR FIRST RESULT")) fail("Developer quickstart is missing or incomplete");
for (const [file, root, type] of [["cursor.json", "mcpServers", undefined], ["vscode.json", "servers", "http"], ["claude-code.json", "mcpServers", "http"]]) {
  const config = await getJson(`${SITE}/install/${file}`);
  if (config.body[root]?.xguard?.url !== `${API}/mcp` || config.body[root]?.xguard?.type !== type) fail(`Invalid editor configuration: ${file}`);
}
const codex = await fetch(freshDiscoveryUrl(`${SITE}/install/codex.toml`), { headers: syntheticHeaders, signal: AbortSignal.timeout(12_000) });
const codexText = await codex.text();
if (!codex.ok || !codexText.includes("[mcp_servers.xguard]") || !codexText.includes(`${API}/mcp`)) fail("Invalid Codex configuration");

const www = await fetch("https://www.xguardgate.com/connect?verification=1", { headers: syntheticHeaders, redirect: "manual", signal: AbortSignal.timeout(12_000) });
if (www.status !== 308 || www.headers.get("location") !== `${SITE}/connect?verification=1`) fail("www canonical redirect is not active");

console.log(JSON.stringify({ ok: true, name: NAME, version: VERSION, mcp_tools: names.size, developer_quickstart: true, free_result: true, paid_intent_402: true, real_payment_performed: false, editor_configs: 4, www_redirect: 308 }));
