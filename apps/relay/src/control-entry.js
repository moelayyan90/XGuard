import site from "./site-universal.js";
import testSite from "./site-test.js";
import safetyTest from "./safety-test.js";
import controlPlane from "./control-plane.js";
import universalEdge, { universalDiscovery } from "./universal-edge.js";

export { MerchantQuota, SettlementReceipt } from "./gateway.js";

const API = "https://api.xguardgate.com";
const VERSION = "4.0.0";
const J = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-xguard-control-plane": VERSION,
    ...headers,
  },
});

const protocolNames = ["x402", "mpp", "ap2", "ucp", "acp", "mcp", "tap", "http"];

async function oldJson(path, env, ctx) {
  const r = await controlPlane.fetch(new Request(`${API}${path}`), env, ctx);
  return r.json().catch(() => ({}));
}

async function health(env, ctx) {
  const base = await oldJson("/healthz", env, ctx);
  const manifest = universalDiscovery();
  return J({
    ...base,
    service: "XGuard Universal Agent Transaction Control Plane",
    version: VERSION,
    protocol_neutral: true,
    protocols: protocolNames,
    universal_edge: manifest.edge,
    universal_edge_pricing: manifest.pricing,
    free_agent_transaction_safety_test: `${API}/v1/test`,
    web_safety_test: "https://xguardgate.com/test",
    native_x402_control_plane: true,
  });
}

async function docs(env, ctx) {
  const base = await oldJson("/docs", env, ctx);
  const manifest = universalDiscovery();
  return J({
    ...base,
    name: "XGuard Universal Agent Transaction Control Plane",
    version: VERSION,
    scope: "protocol-neutral agent payments, commerce, tools and machine transactions",
    protocols: manifest.protocols,
    edge: manifest.edge,
    edge_pricing: manifest.pricing,
    safety_test: {
      web: "https://xguardgate.com/test",
      api: "POST /v1/test",
      schema: "GET /v1/test/schema",
      price: "free",
      checks: ["protocol identification", "idempotency", "context binding", "replay uniqueness", "freshness", "traceability/authorization"]
    },
    endpoints: {
      ...(base.endpoints || {}),
      protocols: "GET /v1/protocols",
      inspect: "POST /v1/inspect",
      safety_test: "POST /v1/test",
      safety_test_schema: "GET /v1/test/schema",
      edge: "/edge/<merchant-host>/<path>",
      xguard_manifest: "GET /.well-known/xguard.json",
    },
  });
}

async function openapi(env, ctx) {
  const base = await oldJson("/openapi.json", env, ctx);
  const paths = { ...(base.paths || {}) };
  paths["/v1/protocols"] = { get: { summary: "Discover XGuard protocol-neutral control-plane capabilities", responses: { "200": { description: "Universal protocol manifest" } } } };
  paths["/v1/inspect"] = { post: { summary: "Classify and policy-check an agent transaction without forwarding it", requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { target: { type: "string" }, method: { type: "string" }, headers: { type: "object" }, body: {} }, required: ["target"] } } } }, responses: { "200": { description: "Detected protocol and policy result" } } } };
  paths["/v1/test"] = { post: { summary: "Free Agent Transaction Safety Test across x402, MPP, AP2, UCP, ACP and MCP", description: "Scores a supplied sample for retry safety, idempotency, context binding, replay uniqueness, freshness and auditability. The target is not contacted.", requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { target: { type: "string" }, method: { type: "string" }, headers: { type: "object" }, body: {} }, required: ["target"] } } } }, responses: { "200": { description: "0–100 structural runtime-readiness report" }, "400": { description: "Invalid sample" } } } };
  paths["/v1/test/schema"] = { get: { summary: "Describe the free Agent Transaction Safety Test", responses: { "200": { description: "Test schema and supported protocols" } } } };
  paths["/edge/{merchant-host}/{path}"] = { parameters: [{ name: "merchant-host", in: "path", required: true, schema: { type: "string" } }, { name: "path", in: "path", required: true, schema: { type: "string" } }], post: { summary: "Proxy a DNS-authorized merchant transaction through XGuard", responses: { "200": { description: "Upstream response" }, "402": { description: "Usage credits required" }, "403": { description: "Merchant hostname has not authorized XGuard Edge" } } } };
  return J({
    ...base,
    info: {
      ...(base.info || {}),
      title: "XGuard Universal Agent Transaction Control Plane",
      version: VERSION,
      description: "Protocol-neutral in-path control layer plus a free runtime-readiness test for x402, MPP, AP2, UCP, ACP, MCP, TAP and generic machine transactions.",
    },
    paths,
  }, 200, { "cache-control": "public, max-age=120" });
}

function agentCard() {
  return {
    name: "XGuard Universal Agent Transaction Control Plane",
    description: "Protocol-neutral transaction firewall, free agent-transaction safety test, metering edge and settlement reliability layer for agent commerce.",
    url: `${API}/mcp`,
    version: VERSION,
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["application/json", "text/plain"],
    defaultOutputModes: ["application/json", "text/plain"],
    skills: [
      { id: "xguard-safety-test", name: "Agent Transaction Safety Test", description: "Score a sample agent payment or commerce transaction for idempotency, replay, context binding, freshness and auditability." },
      { id: "xguard-protocols", name: "Agent transaction protocol discovery", description: "Discover x402, MPP, AP2, UCP, ACP, MCP, TAP and generic edge support." },
      { id: "xguard-inspect", name: "Transaction inspection", description: "Detect the wire protocol and policy-check a transaction before it reaches an origin." },
      { id: "xguard-health", name: "Control-plane health", description: "Inspect XGuard edge and settlement-path health." },
      { id: "xguard-supported", name: "x402 payment-kind aggregation", description: "Discover the x402 payment kinds reachable through XGuard." },
      { id: "xguard-receipt", name: "Settlement receipt lookup", description: "Resolve a durable XGuard settlement receipt." },
    ],
  };
}

const mcpResult = value => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
async function mcp(request, env, ctx) {
  let msg;
  try { msg = await request.clone().json(); } catch { return J({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
  const id = msg.id ?? null;
  if (msg.method === "initialize") return J({ jsonrpc: "2.0", id, result: { protocolVersion: "2026-07-28", capabilities: { tools: {} }, serverInfo: { name: "xguard-control-plane", version: VERSION } } });
  if (msg.method === "notifications/initialized") return new Response(null, { status: 204 });
  if (msg.method === "tools/list") return J({ jsonrpc: "2.0", id, result: { tools: [
    { name: "xguard_safety_test", description: "Free structural runtime-readiness test for an agent payment, checkout or MCP transaction sample. The target is not contacted.", inputSchema: { type: "object", properties: { target: { type: "string" }, method: { type: "string" }, headers: { type: "object" }, body: {} }, required: ["target"] } },
    { name: "xguard_protocols", description: "Discover every transaction protocol and edge surface recognized by XGuard.", inputSchema: { type: "object", properties: {} } },
    { name: "xguard_inspect", description: "Classify and policy-check an agent transaction without forwarding it.", inputSchema: { type: "object", properties: { target: { type: "string" }, method: { type: "string" }, headers: { type: "object" }, body: {} }, required: ["target"] } },
    { name: "xguard_health", description: "Get XGuard transaction control-plane and facilitator health.", inputSchema: { type: "object", properties: {} } },
    { name: "xguard_supported", description: "Return currently supported x402 payment kinds.", inputSchema: { type: "object", properties: {} } },
    { name: "xguard_receipt", description: "Look up a durable XGuard settlement receipt.", inputSchema: { type: "object", properties: { receipt_id: { type: "string" } }, required: ["receipt_id"] } },
    { name: "xguard_integration", description: "Return universal XGuard integration and pricing information.", inputSchema: { type: "object", properties: {} } },
  ] } });
  if (msg.method === "tools/call") {
    const name = msg.params?.name;
    const args = msg.params?.arguments || {};
    if (name === "xguard_safety_test") {
      const r = await safetyTest.fetch(new Request(`${API}/v1/test`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) }));
      return J({ jsonrpc: "2.0", id, result: mcpResult(await r.json().catch(() => ({ error: "safety_test_unavailable" }))) });
    }
    if (name === "xguard_protocols") return J({ jsonrpc: "2.0", id, result: mcpResult(universalDiscovery()) });
    if (name === "xguard_health") return J({ jsonrpc: "2.0", id, result: mcpResult(await (await health(env, ctx)).json()) });
    if (name === "xguard_integration") return J({ jsonrpc: "2.0", id, result: mcpResult(await (await docs(env, ctx)).json()) });
    if (name === "xguard_inspect") {
      const r = await universalEdge.fetch(new Request(`${API}/v1/inspect`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) }), env, ctx);
      return J({ jsonrpc: "2.0", id, result: mcpResult(await r.json().catch(() => ({ error: "inspect_unavailable" }))) });
    }
    return controlPlane.fetch(request, env, ctx);
  }
  return controlPlane.fetch(request, env, ctx);
}

function skill() {
  return `# XGuard Universal Agent Transaction Control Plane\n\nXGuard is a protocol-neutral in-path transaction firewall and metering edge.\n\nRecognized surfaces: x402, MPP, AP2, UCP, ACP, MCP, TAP and generic HTTPS machine transactions.\n\n## Free Agent Transaction Safety Test\nWeb: https://xguardgate.com/test\nAPI: POST ${API}/v1/test\nThe test scores idempotency, context binding, replay uniqueness, freshness and auditability without contacting the target merchant endpoint.\n\n## Universal edge\nA merchant publishes: _xguard.<host> TXT \"xguard-edge=enabled\"\nThen routes agent-facing requests through: ${API}/edge/<merchant-host>/<path>\n\nXGuard detects the protocol, computes a deterministic request digest, blocks unsafe targets and clear binding failures, forwards the request, and meters only successful billable transaction calls. Reads and failed transactions are free.\n\n## Native x402 control plane\nGET /supported\nPOST /verify\nPOST /settle\n\n## Discovery\nGET /v1/protocols\nPOST /v1/inspect\nGET /.well-known/xguard.json\nPOST /mcp\n`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const safetyResponse = await safetyTest.fetch(request, env, ctx);
    if (safetyResponse) return safetyResponse;

    const edgeResponse = await universalEdge.fetch(request, env, ctx);
    if (edgeResponse) return edgeResponse;

    if (url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) return site.fetch(request, env, ctx);
    if ((url.pathname === "/test" || url.pathname === "/agent-payment-safety-test") && (request.method === "GET" || request.method === "HEAD")) return testSite.fetch(request, env, ctx);
    if (url.pathname === "/robots.txt" && request.method === "GET") return new Response("User-agent: *\nAllow: /\nSitemap: https://xguardgate.com/sitemap.xml\n", { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
    if (url.pathname === "/sitemap.xml" && request.method === "GET") return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://xguardgate.com/</loc></url><url><loc>https://xguardgate.com/test</loc></url><url><loc>https://xguardgate.com/agent-payment-safety-test</loc></url></urlset>`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
    if (url.pathname === "/healthz" && request.method === "GET") return health(env, ctx);
    if (url.pathname === "/docs" && request.method === "GET") return docs(env, ctx);
    if (url.pathname === "/openapi.json" && request.method === "GET") return openapi(env, ctx);
    if ((url.pathname === "/.well-known/agent-card.json" || url.pathname === "/.well-known/agent.json" || url.pathname === "/a2a") && request.method === "GET") return J(agentCard(), 200, { "cache-control": "public, max-age=120" });
    if (url.pathname === "/skill.md" && request.method === "GET") return new Response(skill(), { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=120", "x-xguard-control-plane": VERSION } });
    if (url.pathname === "/llms.txt" && request.method === "GET") return new Response(`XGuard Universal Agent Transaction Control Plane\nFree Agent Transaction Safety Test: https://xguardgate.com/test\nSafety Test API: POST ${API}/v1/test\nProtocols: ${protocolNames.join(", ")}\nUniversal manifest: ${API}/v1/protocols\nInspect: POST ${API}/v1/inspect\nEdge: ${API}/edge/<merchant-host>/<path>\nMCP: ${API}/mcp\nNative x402: ${API}/supported, POST /verify, POST /settle\n`, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=120" } });
    if (url.pathname === "/mcp" && request.method === "POST") return mcp(request, env, ctx);
    if (url.pathname === "/mcp" && request.method === "HEAD") return new Response(null, { status: 200, headers: { allow: "POST, HEAD", "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-xguard-control-plane": VERSION } });
    return controlPlane.fetch(request, env, ctx);
  },
  async scheduled(controller) {
    console.log(JSON.stringify({ event: "scheduled", cron: controller.cron, scheduledTime: controller.scheduledTime, service: "xguard-mainnet" }));
  }
};
