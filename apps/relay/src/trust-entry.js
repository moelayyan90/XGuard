import app from "./rail-entry.js";

export {
  MerchantQuota,
  SettlementReceipt,
  AgentAuthority,
  RailKeyAuthority,
  RailPermitState,
  RailMeter,
} from "./rail-entry.js";

const VERSION = "5.0.1";
const HSTS = "max-age=31536000; includeSubDomains";

const TOOL_EXAMPLES = Object.freeze({
  xguard_facilitator: "Example: call with no arguments before configuring XGuard as an x402 facilitator.",
  xguard_route: "Example: network='eip155:8453', scheme='exact'.",
  xguard_discovery_search: "Example: query='weather', limit=10.",
  xguard_safety_test: "Example: target='https://example.com/pay', method='POST'.",
  xguard_protocols: "Example: call with no arguments to list the transaction protocols XGuard recognizes.",
  xguard_inspect: "Example: target='https://example.com/pay', method='POST'.",
  xguard_health: "Example: call with no arguments to inspect XGuard and downstream-route health.",
  xguard_supported: "Example: call with no arguments before choosing an x402 payment kind.",
  xguard_receipt: "Example: supply a receipt_id beginning with 'xgr_' followed by 40 lowercase hex characters.",
  xguard_integration: "Example: call with no arguments to retrieve integration and security-control details.",
});

function harden(response) {
  if (!(response instanceof Response)) return response;
  const headers = new Headers(response.headers);
  headers.set("strict-transport-security", HSTS);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("x-xguard-control-plane", VERSION);
  headers.delete("server");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function httpsRedirect(request) {
  const url = new URL(request.url);
  if (url.protocol !== "http:") return null;
  url.protocol = "https:";
  return new Response(null, {
    status: 308,
    headers: {
      location: url.toString(),
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
}

async function improveToolsList(request, response) {
  if (!(response instanceof Response) || !response.ok) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/mcp" || request.method !== "POST") return response;

  let message;
  try {
    message = await request.clone().json();
  } catch {
    return response;
  }
  if (message?.method !== "tools/list") return response;

  const body = await response.clone().json().catch(() => null);
  const tools = body?.result?.tools;
  if (!Array.isArray(tools)) return response;

  for (const tool of tools) {
    const example = TOOL_EXAMPLES[tool?.name];
    if (example && typeof tool.description === "string" && !/\bExample:/i.test(tool.description)) {
      tool.description = `${tool.description.replace(/\s+$/u, "")} ${example}`;
    }

    const annotations = tool.annotations && typeof tool.annotations === "object"
      ? { ...tool.annotations }
      : {};
    if (typeof annotations.readOnlyHint !== "boolean") annotations.readOnlyHint = true;
    if (typeof annotations.destructiveHint !== "boolean") annotations.destructiveHint = false;
    if (typeof annotations.idempotentHint !== "boolean") annotations.idempotentHint = true;
    if (typeof annotations.openWorldHint !== "boolean") annotations.openWorldHint = false;
    tool.annotations = annotations;
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const redirect = httpsRedirect(request);
    if (redirect) return redirect;

    const response = await app.fetch(request, env, ctx);
    const improved = await improveToolsList(request, response);
    return harden(improved);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  },
};
