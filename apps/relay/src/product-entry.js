import app from "./egress-entry.js";
import { hostedGateResponse } from "./hosted-gate.js";

export {
  MerchantQuota,
  SettlementReceipt,
  AgentAuthority,
  RailKeyAuthority,
  RailPermitState,
  RailMeter,
  ActionKeyAuthority,
  ActionPermitState,
  ActionMeter,
  EgressKeyAuthority,
  EgressCredentialState,
  EgressTenantIndex,
  EgressCapabilityState,
  EgressMeter,
} from "./egress-entry.js";

const VERSION = "5.0.1";
const NAME = "xguard-secretless-agent-gateway";
const API = "https://api.xguardgate.com";
const MCP = `${API}/mcp`;

const HOSTED_GATE_TOOL = {
  name: "xguard_hosted_gate",
  description: "Discover XGuard Hosted Gate for Nginx, Caddy, Traefik and other reverse proxies. It returns x402 payment challenges and authorizes the private origin only after XGuard verification and settlement succeed.",
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", additionalProperties: true },
  annotations: { title: "XGuard Hosted Gate", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

async function readMcp(snapshot) {
  if (!snapshot) return null;
  try { return await snapshot.clone().json(); } catch { return null; }
}

function mcpResult(id, data) {
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: id ?? null,
    result: {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    },
  }), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function handleHostedGateMcp(snapshot, env, ctx) {
  const message = await readMcp(snapshot);
  if (message?.method !== "tools/call" || message?.params?.name !== HOSTED_GATE_TOOL.name) return null;
  const response = await hostedGateResponse(new Request(`${API}/v1/gate`), env, ctx, app);
  return mcpResult(message.id, await response.json());
}

async function improveMcp(snapshot, response) {
  if (!(response instanceof Response) || !response.ok || !snapshot) return response;
  const message = await readMcp(snapshot);
  const body = await response.clone().json().catch(() => null);
  if (!body?.result) return response;

  if (message?.method === "initialize") {
    body.result.serverInfo = { ...(body.result.serverInfo || {}), name: NAME, version: VERSION };
    body.result.instructions = `XGuard Secretless Agent Gateway keeps reusable upstream API credentials outside AI agent context. Operators provision encrypted credentials and scoped capabilities; agents use xguard_egress_fetch. XGuard Hosted Gate lets Nginx, Caddy, Traefik and other reverse proxies enforce x402 payment before a private origin. Canonical remote MCP endpoint: ${MCP}. Action Rail, x402 facilitator routing, receipts and inspection remain available.`;
  }

  if (message?.method === "tools/list" && Array.isArray(body.result.tools)) {
    if (!body.result.tools.some(tool => tool?.name === HOSTED_GATE_TOOL.name)) body.result.tools.unshift(HOSTED_GATE_TOOL);
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("x-xguard-canonical-mcp", MCP);
  headers.set("x-xguard-control-plane", VERSION);
  return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers });
}

async function improveMachineDiscovery(url, response) {
  if (!(response instanceof Response) || !response.ok) return response;
  const contentType = response.headers.get("content-type") || "";

  if ((url.pathname === "/llms.txt" || url.pathname === "/skill.md") && contentType.includes("text/")) {
    const text = await response.clone().text();
    if (text.includes("/v1/gate/authorize")) return response;
    const addition = `\n\nXGuard Hosted Gate\nGET ${API}/v1/gate\nGET|POST ${API}/v1/gate/authorize\nPurpose: put x402 payment enforcement in an existing Nginx, Caddy, Traefik or custom reverse-proxy path without adding payment middleware to the application. Configure payTo and amount in trusted proxy configuration; keep the origin private to prevent bypass.\n`;
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(text + addition, { status: response.status, statusText: response.statusText, headers });
  }

  if (!contentType.includes("application/json")) return response;
  if (!["/openapi.json", "/docs", "/architecture", "/v1/protocols", "/.well-known/xguard.json", "/.well-known/ai-plugin.json", "/.well-known/agent-card.json", "/.well-known/agent.json", "/a2a"].includes(url.pathname)) return response;

  const body = await response.clone().json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return response;
  body.hosted_gate = {
    discovery: `${API}/v1/gate`,
    authorize: `${API}/v1/gate/authorize`,
    role: "external x402 payment authorization point for reverse proxies",
    gateways: ["Nginx auth_request", "Caddy forward_auth", "Traefik ForwardAuth", "custom reverse proxies"],
    rule: "origin access is authorized only after successful settlement",
  };

  if (url.pathname === "/openapi.json") {
    body.paths = { ...(body.paths || {}),
      "/v1/gate": { get: { summary: "Discover XGuard Hosted Gate", responses: { "200": { description: "Hosted Gate contract" } } } },
      "/v1/gate/authorize": {
        get: { summary: "Reverse-proxy x402 authorization subrequest", responses: { "204": { description: "Payment settled; origin may be reached" }, "401": { description: "Nginx auth_request challenge mode" }, "402": { description: "PAYMENT-REQUIRED challenge" }, "503": { description: "Ambiguous or unavailable settlement; fail closed" } } },
        post: { summary: "Reverse-proxy x402 authorization subrequest", responses: { "204": { description: "Payment settled; origin may be reached" }, "402": { description: "PAYMENT-REQUIRED challenge" }, "503": { description: "Ambiguous or unavailable settlement; fail closed" } } },
      },
    };
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers });
}

function harden(response) {
  if (!(response instanceof Response)) return response;
  const headers = new Headers(response.headers);
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("x-xguard-control-plane", VERSION);
  headers.delete("server");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/v1/gate" || url.pathname === "/v1/gate/authorize") {
      const gate = await hostedGateResponse(request, env, ctx, app);
      if (gate) return harden(gate);
    }

    const snapshot = url.pathname === "/mcp" && request.method === "POST" ? request.clone() : null;
    const hostedMcp = await handleHostedGateMcp(snapshot, env, ctx);
    if (hostedMcp) return harden(hostedMcp);

    let response = await app.fetch(request, env, ctx);
    if (snapshot) response = await improveMcp(snapshot, response);
    response = await improveMachineDiscovery(url, response);
    return response;
  },
  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  },
};
