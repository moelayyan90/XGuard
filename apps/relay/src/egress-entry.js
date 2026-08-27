import app from "./trust-entry.js";
import egress, { EgressKeyAuthority, EgressCredentialState, EgressTenantIndex, EgressCapabilityState, EgressMeter } from "./egress-vault.js";

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
} from "./trust-entry.js";
export { EgressKeyAuthority, EgressCredentialState, EgressTenantIndex, EgressCapabilityState, EgressMeter };

const API = "https://api.xguardgate.com";

const EGRESS_DISCOVERY_TOOL = {
  name: "xguard_secretless_egress",
  description: "Discover XGuard Secretless Egress. Operators keep reusable upstream API credentials inside XGuard and give AI agents only short-lived scoped XGuard capabilities. Agents never receive the upstream secret.",
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", additionalProperties: true },
  annotations: { title: "XGuard Secretless Egress", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

const EGRESS_FETCH_TOOL = {
  name: "xguard_egress_fetch",
  description: "Execute one scoped outbound HTTPS request using an XGuard capability. XGuard validates the capability, bills Usage Credits, injects the upstream credential server-side, never follows redirects and never returns the reusable credential to the agent.",
  inputSchema: {
    type: "object",
    required: ["capability", "target"],
    properties: {
      capability: { type: "string", description: "Short-lived XGuard capability issued by the operator." },
      target: { type: "string", description: "Public HTTPS URL within the capability scope." },
      method: { type: "string", enum: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] },
      headers: { type: "object", additionalProperties: { type: "string" } },
      body_json: {},
      body_text: { type: "string" },
      body_base64: { type: "string" },
      content_type: { type: "string" },
    },
  },
  outputSchema: { type: "object", additionalProperties: true },
  annotations: { title: "XGuard Egress Fetch", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
};

async function mcpRequest(snapshot) {
  if (!snapshot) return null;
  try { return await snapshot.clone().json(); } catch { return null; }
}

function mcpResult(id, data) {
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: id ?? null,
    result: {
      content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data) }],
      structuredContent: typeof data === "object" && data !== null ? data : { value: data },
    },
  }), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function handleEgressMcp(snapshot, env) {
  const message = await mcpRequest(snapshot);
  if (!message || message.method !== "tools/call") return null;
  const name = message?.params?.name;
  if (name === EGRESS_DISCOVERY_TOOL.name) {
    const response = await egress.fetch(new Request(`${API}/v1/egress`), env);
    return mcpResult(message.id, await response.json());
  }
  if (name === EGRESS_FETCH_TOOL.name) {
    const args = message?.params?.arguments || {};
    const response = await egress.fetch(new Request(`${API}/v1/egress/fetch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    }), env);
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) return mcpResult(message.id, await response.json());
    const text = await response.text();
    return mcpResult(message.id, { status: response.status, body: text, headers: Object.fromEntries(response.headers) });
  }
  return null;
}

async function improveToolsList(snapshot, response) {
  if (!(response instanceof Response) || !response.ok || !snapshot) return response;
  const message = await mcpRequest(snapshot);
  if (message?.method !== "tools/list") return response;
  const body = await response.clone().json().catch(() => null);
  const tools = body?.result?.tools;
  if (!Array.isArray(tools)) return response;
  if (!tools.some(tool => tool?.name === EGRESS_DISCOVERY_TOOL.name)) tools.unshift(EGRESS_DISCOVERY_TOOL);
  if (!tools.some(tool => tool?.name === EGRESS_FETCH_TOOL.name)) tools.unshift(EGRESS_FETCH_TOOL);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const snapshot = url.pathname === "/mcp" && request.method === "POST" ? request.clone() : null;

    const mcpResponse = await handleEgressMcp(snapshot, env);
    if (mcpResponse) return mcpResponse;

    const egressResponse = await egress.fetch(request, env, ctx);
    if (egressResponse instanceof Response) return egressResponse;

    const response = await app.fetch(request, env, ctx);
    return improveToolsList(snapshot, response);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  },
};
