import app from "./rail-entry.js";
import actionRail, { ActionKeyAuthority, ActionPermitState, ActionMeter } from "./action-rail.js";
import actionSite from "./site-action.js";

export {
  MerchantQuota,
  SettlementReceipt,
  AgentAuthority,
  RailKeyAuthority,
  RailPermitState,
  RailMeter,
} from "./rail-entry.js";
export { ActionKeyAuthority, ActionPermitState, ActionMeter };

const VERSION = "5.0.1";
const HSTS = "max-age=31536000; includeSubDomains";
const BRAND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="XGuard"><rect width="64" height="64" rx="14" fill="#0b0b0b"/><path d="M14 12h11l7 12 7-12h11L38.5 32 51 52H40l-8-13-8 13H13l12.5-20z" fill="#f4f2eb"/><path d="M32 7v10M32 47v10" stroke="#ff5a1f" stroke-width="4" stroke-linecap="round"/></svg>`;

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
  xguard_action_rail: "Example: call with no arguments to discover the protocol-neutral Action Rail and its single-use permit flow.",
});

const ACTION_TOOL = {
  name: "xguard_action_rail",
  description: "Discover XGuard Action Rail: a protocol-neutral execution gate for AI side effects. It requires a scoped mandate plus a signed, request-bound, single-use permit before XGuard executes a payment, purchase, booking, message, deployment, delete, write or tool action.",
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", additionalProperties: true },
  annotations: {
    title: "XGuard Action Rail",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

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

function brandResponse(request) {
  return new Response(request.method === "HEAD" ? null : BRAND_SVG, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}

async function handleActionMcp(snapshot, env) {
  if (!snapshot) return null;
  let message;
  try { message = await snapshot.clone().json(); } catch { return null; }
  if (message?.method !== "tools/call" || message?.params?.name !== "xguard_action_rail") return null;
  const response = await actionRail.fetch(new Request("https://api.xguardgate.com/v1/actions"), env);
  const data = await response.json();
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: message.id ?? null,
    result: {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    },
  }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function improveToolsList(snapshot, response) {
  if (!(response instanceof Response) || !response.ok || !snapshot) return response;

  let message;
  try {
    message = await snapshot.json();
  } catch {
    return response;
  }
  if (message?.method !== "tools/list") return response;

  const body = await response.clone().json().catch(() => null);
  const tools = body?.result?.tools;
  if (!Array.isArray(tools)) return response;
  if (!tools.some(tool => tool?.name === ACTION_TOOL.name)) tools.unshift(ACTION_TOOL);

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

    const url = new URL(request.url);
    if (["/logo.svg", "/brand.svg", "/favicon.svg", "/favicon.ico"].includes(url.pathname) && ["GET", "HEAD"].includes(request.method)) {
      return harden(brandResponse(request));
    }

    if (url.hostname === "xguardgate.com" && url.pathname === "/" && ["GET", "HEAD"].includes(request.method)) {
      const siteResponse = await actionSite.fetch(request, env, ctx);
      if (siteResponse instanceof Response) return harden(siteResponse);
    }

    const snapshot = url.pathname === "/mcp" && request.method === "POST"
      ? request.clone()
      : null;

    const actionMcp = await handleActionMcp(snapshot, env);
    if (actionMcp) return harden(actionMcp);

    const actionResponse = await actionRail.fetch(request, env, ctx);
    if (actionResponse instanceof Response) return harden(actionResponse);

    const response = await app.fetch(request, env, ctx);
    const improved = await improveToolsList(snapshot, response);
    return harden(improved);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  },
};
