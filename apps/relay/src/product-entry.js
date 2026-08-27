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
const MCP = "https://api.xguardgate.com/mcp";

async function improveInitialize(snapshot, response) {
  if (!(response instanceof Response) || !response.ok || !snapshot) return response;
  let message;
  try { message = await snapshot.json(); } catch { return response; }
  if (message?.method !== "initialize") return response;
  const body = await response.clone().json().catch(() => null);
  if (!body?.result) return response;
  body.result.serverInfo = { ...(body.result.serverInfo || {}), name: NAME, version: VERSION };
  body.result.instructions = `XGuard Secretless Agent Gateway keeps reusable upstream API credentials outside AI agent context. Operators provision encrypted credentials and scoped capabilities; agents use xguard_egress_fetch. Canonical remote MCP endpoint: ${MCP}. XGuard Hosted Gate, Action Rail, x402 facilitator routing, receipts and inspection remain available as compatibility capabilities.`;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("x-xguard-canonical-mcp", MCP);
  headers.set("x-xguard-control-plane", VERSION);
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
    const response = await app.fetch(request, env, ctx);
    if (snapshot) return improveInitialize(snapshot, response);
    return response;
  },
  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  },
};
