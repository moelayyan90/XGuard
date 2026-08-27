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
const API = "https://xguardgate.com/api";
const SITE = "https://xguardgate.com";
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

function llmsText() {
  return `XGuard Action Rail\nVersion: ${VERSION}\nWebsite: ${SITE}\nAPI: ${API}\nPrimary role: protocol-neutral execution control plane for irreversible AI side effects.\n\nAction Rail:\nGET ${API}/v1/actions\nPOST ${API}/v1/actions/permits\nPOST ${API}/v1/actions/execute\nGET ${API}/v1/actions/pricing\nGET ${API}/v1/actions/stats\nGET ${API}/.well-known/xguard-actions.json\nGET ${API}/.well-known/xguard-actions-key.json\n\nAuthority:\nPOST ${API}/v1/mandates\nGET ${API}/v1/mandates/status\nPOST ${API}/v1/mandates/revoke\n\nRecognized agent/commerce surfaces: HTTP, MCP, x402, MPP, AP2, ACP, UCP, TAP.\nNative x402 compatibility remains available at GET /supported, POST /verify and POST /settle.\nAction Rail permits are cryptographically signed, bound to target/method/action/protocol/request hash and license, single-use, and fail closed on ambiguous transport or HTTP 5xx outcomes.\n`;
}

function skillText() {
  return `# XGuard Action Rail\n\nXGuard is a protocol-neutral execution boundary for AI side effects. Use it when an agent is about to perform an irreversible external action such as a payment, purchase, booking, message, deployment, delete, API write or tool call.\n\n## Core flow\n1. Create a scoped mandate with POST ${API}/v1/mandates.\n2. Prepare one signed request-bound permit with POST ${API}/v1/actions/permits.\n3. Execute exactly that request once with POST ${API}/v1/actions/execute.\n4. Inspect the durable permit state at GET ${API}/v1/actions/permits/{permit_id}.\n\nThe permit binds action, protocol, target, HTTP method, request-body SHA-256 digest, amount context and the SHA-256 binding of the XGuard Usage Credit license. Replays are rejected. Transport failures and HTTP 5xx outcomes enter an ambiguous state and are not automatically replayed.\n\n## Billing\nThe current Action Rail configuration consumes one XGuard Usage Credit after a known successful 2xx/3xx upstream execution. Known failed and ambiguous outcomes do not count as successful Action Rail executions.\n\n## Compatibility\nXGuard also retains its native x402 v2 facilitator endpoints and its universal transaction edge. Recognized surfaces include HTTP, MCP, x402, MPP, AP2, ACP, UCP and TAP.\n`;
}

function sitemapResponse(request) {
  const origin = new URL(request.url).origin;
  const paths = origin === SITE
    ? ["/", "/test", "/.well-known/security.txt", "/logo.svg"]
    : ["/", "/v1/actions", "/.well-known/xguard-actions.json", "/.well-known/xguard.json", "/architecture", "/docs", "/openapi.json", "/mcp", "/llms.txt", "/skill.md", "/facilitator", "/supported"];
  const body = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path => `<url><loc>${origin}${path}</loc></url>`).join("")}</urlset>`;
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}

async function handleActionMcp(snapshot, env) {
  if (!snapshot) return null;
  let message;
  try { message = await snapshot.clone().json(); } catch { return null; }
  if (message?.method !== "tools/call" || message?.params?.name !== "xguard_action_rail") return null;
  const response = await actionRail.fetch(new Request(`${API}/v1/actions`), env);
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
  try { message = await snapshot.json(); } catch { return response; }
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
    const annotations = tool.annotations && typeof tool.annotations === "object" ? { ...tool.annotations } : {};
    if (typeof annotations.readOnlyHint !== "boolean") annotations.readOnlyHint = true;
    if (typeof annotations.destructiveHint !== "boolean") annotations.destructiveHint = false;
    if (typeof annotations.idempotentHint !== "boolean") annotations.idempotentHint = true;
    if (typeof annotations.openWorldHint !== "boolean") annotations.openWorldHint = false;
    tool.annotations = annotations;
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers });
}

async function improvePublicJson(url, response) {
  if (!(response instanceof Response) || !response.ok) return response;
  if (!(response.headers.get("content-type") || "").includes("application/json")) return response;
  if (!["/openapi.json", "/docs", "/.well-known/agent-card.json", "/.well-known/agent.json", "/a2a"].includes(url.pathname)) return response;
  const body = await response.clone().json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return response;

  if (url.pathname === "/openapi.json") {
    body.info = {
      ...(body.info || {}),
      title: "XGuard Action Rail",
      version: VERSION,
      description: "Protocol-neutral execution control plane for AI side effects, with scoped mandates, cryptographically signed request-bound single-use permits, replay rejection, durable receipts and native x402 compatibility.",
    };
    body.paths = {
      ...(body.paths || {}),
      "/v1/actions": { get: { summary: "Discover XGuard Action Rail", responses: { "200": { description: "Action Rail manifest" } } } },
      "/v1/actions/permits": { post: { summary: "Prepare one signed single-use AI action permit", responses: { "201": { description: "Signed action permit" }, "401": { description: "XGuard key required" }, "402": { description: "Usage Credits required" }, "428": { description: "Scoped mandate required" } } } },
      "/v1/actions/execute": { post: { summary: "Execute the exact request bound to an XGuard action permit", responses: { "200": { description: "Upstream response after controlled execution" }, "402": { description: "Usage Credits required" }, "409": { description: "Replay, state or binding conflict" }, "503": { description: "Ambiguous outcome; fail closed" } } } },
      "/v1/actions/pricing": { get: { summary: "Action Rail Usage Credit billing boundary", responses: { "200": { description: "Pricing metadata" } } } },
      "/v1/actions/stats": { get: { summary: "Action Rail execution and billing counters", responses: { "200": { description: "Durable counters" } } } },
    };
  } else if (url.pathname === "/docs") {
    body.name = "XGuard Action Rail";
    body.primary_role = "protocol-neutral execution control plane for irreversible AI side effects";
    body.action_rail = {
      manifest: "GET /v1/actions",
      permit: "POST /v1/actions/permits",
      execute: "POST /v1/actions/execute",
      pricing: "GET /v1/actions/pricing",
      stats: "GET /v1/actions/stats",
      authority: "POST /v1/mandates",
      controls: ["mandate", "budget", "action allowlist", "merchant allowlist", "signed request binding", "single use", "replay rejection", "expiry", "fail-closed ambiguity", "receipt"],
    };
    body.x402_compatibility = { facilitator_url: API, supported: "GET /supported", verify: "POST /verify", settle: "POST /settle" };
  } else {
    body.name = "XGuard Action Rail";
    body.description = "Protocol-neutral execution control plane for AI agents: scoped mandates, signed request-bound single-use permits, replay rejection and durable receipts for irreversible side effects.";
    body.version = VERSION;
    const skills = Array.isArray(body.skills) ? body.skills : [];
    if (!skills.some(skill => skill?.id === "xguard-action-rail")) {
      skills.unshift({ id: "xguard-action-rail", name: "AI Action Rail", description: "Authorize and execute irreversible agent side effects through scoped mandates and signed single-use permits." });
    }
    body.skills = skills;
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const redirect = httpsRedirect(request);
    if (redirect) return redirect;

    const url = new URL(request.url);
    if (["/logo.svg", "/brand.svg", "/favicon.svg", "/favicon.ico"].includes(url.pathname) && ["GET", "HEAD"].includes(request.method)) {
      return harden(brandResponse(request));
    }
    if (url.pathname === "/sitemap.xml" && ["GET", "HEAD"].includes(request.method)) return harden(sitemapResponse(request));
    if (url.pathname === "/llms.txt" && request.method === "GET") return harden(new Response(llmsText(), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=120" } }));
    if (url.pathname === "/skill.md" && request.method === "GET") return harden(new Response(skillText(), { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=120" } }));

    if (url.hostname === "xguardgate.com" && url.pathname === "/" && ["GET", "HEAD"].includes(request.method)) {
      const siteResponse = await actionSite.fetch(request, env, ctx);
      if (siteResponse instanceof Response) return harden(siteResponse);
    }

    const snapshot = url.pathname === "/mcp" && request.method === "POST" ? request.clone() : null;
    const actionMcp = await handleActionMcp(snapshot, env);
    if (actionMcp) return harden(actionMcp);

    const actionResponse = await actionRail.fetch(request, env, ctx);
    if (actionResponse instanceof Response) return harden(actionResponse);

    const response = await app.fetch(request, env, ctx);
    const publicResponse = await improvePublicJson(url, response);
    const improved = await improveToolsList(snapshot, publicResponse);
    return harden(improved);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  },
};
