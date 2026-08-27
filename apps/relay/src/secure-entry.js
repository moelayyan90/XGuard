import legacy from "./entry.js";
import market from "./x402-market.js";

export { MerchantQuota, SettlementReceipt, AgentAuthority } from "./entry.js";

const API = "https://api.xguardgate.com";
const VERSION = "5.0.0";
const HSTS = "max-age=31536000; includeSubDomains";

const OUTPUT_SCHEMA = {
  type: "object",
  description: "Structured JSON result returned by XGuard.",
  additionalProperties: true,
};

const CLOSED_READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const OPEN_READ_ONLY = {
  ...CLOSED_READ_ONLY,
  openWorldHint: true,
};

const TRANSACTION_INPUT = {
  type: "object",
  properties: {
    target: { type: "string", description: "Absolute HTTPS transaction target URL." },
    method: { type: "string", description: "HTTP method, for example POST." },
    headers: { type: "object", description: "Optional request headers used for protocol detection." },
    body: { description: "Optional JSON-compatible request body." },
  },
  required: ["target"],
};

const TOOLS = [
  {
    name: "xguard_facilitator",
    description: "Return XGuard's machine-readable x402 facilitator identity, endpoints, live capabilities, automatic routing policy and pricing.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: OUTPUT_SCHEMA,
    annotations: { ...OPEN_READ_ONLY, title: "XGuard x402 Facilitator" },
  },
  {
    name: "xguard_route",
    description: "Ask XGuard which live downstream settlement path it would choose for an x402 network/scheme while keeping XGuard as the configured facilitator URL.",
    inputSchema: {
      type: "object",
      properties: {
        network: { type: "string", description: "Optional CAIP-2 network, for example eip155:8453." },
        scheme: { type: "string", description: "Optional x402 scheme, for example exact or batch-settlement." },
      },
    },
    outputSchema: OUTPUT_SCHEMA,
    annotations: { ...OPEN_READ_ONLY, title: "XGuard Automatic Route" },
  },
  {
    name: "xguard_discovery_search",
    description: "Search the x402 Bazaar catalogs reachable through XGuard without knowing a provider or tool name in advance.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      required: ["query"],
    },
    outputSchema: OUTPUT_SCHEMA,
    annotations: { ...OPEN_READ_ONLY, title: "XGuard x402 Discovery Search" },
  },
  {
    name: "xguard_safety_test",
    description: "Score a transaction sample without contacting its target. Example: target='https://example.com/pay', method='POST'.",
    inputSchema: TRANSACTION_INPUT,
    outputSchema: OUTPUT_SCHEMA,
    annotations: { ...CLOSED_READ_ONLY, title: "XGuard Safety Test" },
  },
  {
    name: "xguard_protocols",
    description: "List transaction protocols and edge surfaces recognized by XGuard.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: OUTPUT_SCHEMA,
    annotations: { ...CLOSED_READ_ONLY, title: "XGuard Protocols" },
  },
  {
    name: "xguard_inspect",
    description: "Classify and policy-check a transaction without forwarding it.",
    inputSchema: TRANSACTION_INPUT,
    outputSchema: OUTPUT_SCHEMA,
    annotations: { ...CLOSED_READ_ONLY, title: "XGuard Inspect" },
  },
  {
    name: "xguard_health",
    description: "Return XGuard facilitator and downstream settlement-path health.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: OUTPUT_SCHEMA,
    annotations: { ...OPEN_READ_ONLY, title: "XGuard Health" },
  },
  {
    name: "xguard_supported",
    description: "Return currently supported x402 payment kinds aggregated from healthy configured settlement providers.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: OUTPUT_SCHEMA,
    annotations: { ...OPEN_READ_ONLY, title: "XGuard Supported Payments" },
  },
  {
    name: "xguard_receipt",
    description: "Look up a durable XGuard settlement receipt.",
    inputSchema: {
      type: "object",
      properties: {
        receipt_id: { type: "string", description: "Durable XGuard receipt ID beginning with xgr_." },
      },
      required: ["receipt_id"],
    },
    outputSchema: OUTPUT_SCHEMA,
    annotations: { ...CLOSED_READ_ONLY, title: "XGuard Receipt" },
  },
  {
    name: "xguard_integration",
    description: "Return integration, security controls and pricing for the XGuard in-path facilitator URL.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: OUTPUT_SCHEMA,
    annotations: { ...CLOSED_READ_ONLY, title: "XGuard Integration" },
  },
];

function harden(response) {
  const headers = new Headers(response.headers);
  headers.set("strict-transport-security", HSTS);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("x-xguard-control-plane", VERSION);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(body, status = 200, extraHeaders = {}) {
  return harden(new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  }));
}

function structured(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (Array.isArray(value)) return { items: value };
  return { value };
}

function mcpResult(value, isError = false) {
  const structuredContent = structured(value);
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
}

async function legacyJson(path, env, ctx, { method = "GET", body } = {}) {
  const request = new Request(`${API}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await legacy.fetch(request, env, ctx);
  const data = await response.json().catch(() => ({ error: "invalid_json_response" }));
  if (data && typeof data === "object" && !Array.isArray(data) && Object.prototype.hasOwnProperty.call(data, "version")) data.version = VERSION;
  if (data?.info && typeof data.info === "object" && Object.prototype.hasOwnProperty.call(data.info, "version")) data.info.version = VERSION;
  return { response, data };
}

async function marketJson(path, env) {
  const request = new Request(`${API}${path}`);
  const response = await market.fetch(request, env);
  if (!(response instanceof Response)) return { response: new Response(null, { status: 404 }), data: { error: "market_surface_not_found" } };
  const data = await response.json().catch(() => ({ error: "invalid_json_response" }));
  return { response, data };
}

async function mcp(request, env, ctx) {
  let message;
  try {
    message = await request.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }

  const id = message.id ?? null;

  if (message.method === "initialize") {
    return json({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2026-07-28",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "xguard-high-velocity-x402-facilitator", version: VERSION },
      },
    });
  }

  if (message.method === "notifications/initialized") return harden(new Response(null, { status: 204 }));
  if (message.method === "tools/list") return json({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (message.method !== "tools/call") return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });

  const name = message.params?.name;
  const args = message.params?.arguments || {};
  let result;

  if (name === "xguard_facilitator") {
    result = await marketJson("/facilitator", env);
  } else if (name === "xguard_route") {
    const q = new URLSearchParams();
    if (args.network) q.set("network", String(args.network));
    if (args.scheme) q.set("scheme", String(args.scheme));
    result = await marketJson(`/v1/facilitator/route?${q.toString()}`, env);
  } else if (name === "xguard_discovery_search") {
    const q = new URLSearchParams({ query: String(args.query || "") });
    if (args.limit) q.set("limit", String(args.limit));
    result = await marketJson(`/discovery/search?${q.toString()}`, env);
  } else if (name === "xguard_safety_test") {
    result = await legacyJson("/v1/test", env, ctx, { method: "POST", body: args });
  } else if (name === "xguard_protocols") {
    result = await legacyJson("/v1/protocols", env, ctx);
  } else if (name === "xguard_inspect") {
    result = await legacyJson("/v1/inspect", env, ctx, { method: "POST", body: args });
  } else if (name === "xguard_health") {
    result = await legacyJson("/healthz", env, ctx);
  } else if (name === "xguard_supported") {
    result = await legacyJson("/supported", env, ctx);
  } else if (name === "xguard_receipt") {
    const receiptId = String(args.receipt_id || "");
    if (!/^xgr_[a-f0-9]{40}$/.test(receiptId)) return json({ jsonrpc: "2.0", id, result: mcpResult({ error: "invalid_receipt_id" }, true) });
    result = await legacyJson(`/v1/receipts/${receiptId}`, env, ctx);
  } else if (name === "xguard_integration") {
    result = await legacyJson("/docs", env, ctx);
  } else {
    return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unknown tool" } });
  }

  return json({ jsonrpc: "2.0", id, result: mcpResult(result.data, !result.response.ok) });
}

const VERSIONED_JSON_PATHS = new Set([
  "/healthz",
  "/docs",
  "/openapi.json",
  "/architecture",
  "/.well-known/agent-card.json",
  "/.well-known/agent.json",
  "/a2a",
]);

async function normalizeVersion(response, pathname) {
  if (!VERSIONED_JSON_PATHS.has(pathname)) return response;
  if (!(response.headers.get("content-type") || "").includes("application/json")) return response;

  const data = await response.clone().json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) return response;

  let changed = false;
  if (Object.prototype.hasOwnProperty.call(data, "version")) {
    data.version = VERSION;
    changed = true;
  }
  if (data.info && typeof data.info === "object" && Object.prototype.hasOwnProperty.call(data.info, "version")) {
    data.info.version = VERSION;
    changed = true;
  }

  if (pathname === "/healthz") {
    data.service = "XGuard High-Velocity x402 Facilitator";
    data.primary_role = "public in-path x402 facilitator with automatic capability/health routing";
    data.facilitator_url = API;
    data.discovery = {
      provider: `${API}/facilitator`,
      resources: `${API}/discovery/resources`,
      search: `${API}/discovery/search`,
      route: `${API}/v1/facilitator/route`,
    };
    changed = true;
  }

  if (pathname === "/docs") {
    data.name = "XGuard High-Velocity x402 Facilitator";
    data.primary_role = "single x402 facilitator URL above multiple settlement providers";
    data.facilitator_url = API;
    data.facilitator_discovery = {
      provider: "GET /facilitator",
      resources: "GET /discovery/resources",
      search: "GET /discovery/search?query=...",
      automatic_route: "GET /v1/facilitator/route?network=...&scheme=...",
      well_known: "GET /.well-known/x402",
    };
    changed = true;
  }

  if (pathname === "/openapi.json") {
    data.info = {
      ...(data.info || {}),
      title: "XGuard High-Velocity x402 Facilitator",
      version: VERSION,
      description: "Public x402 facilitator with automatic capability-, health- and latency-aware settlement routing, failover, replay protection, discovery aggregation and ambiguous-settlement reconciliation.",
    };
    data.paths = {
      ...(data.paths || {}),
      "/facilitator": { get: { summary: "Machine-readable XGuard facilitator identity and routing capabilities", responses: { "200": { description: "Facilitator metadata" } } } },
      "/discovery/resources": { get: { summary: "List x402 Bazaar resources reachable through XGuard catalogs", responses: { "200": { description: "Aggregated x402 discovery resources" } } } },
      "/discovery/search": { get: { summary: "Search x402 Bazaar resources reachable through XGuard", responses: { "200": { description: "Aggregated x402 discovery search results" } } } },
      "/v1/facilitator/route": { get: { summary: "Inspect the route XGuard would select for a network/scheme", responses: { "200": { description: "Live compatible route recommendation" }, "503": { description: "No compatible live route" } } } },
    };
    changed = true;
  }

  if (pathname === "/.well-known/agent-card.json" || pathname === "/.well-known/agent.json" || pathname === "/a2a") {
    data.name = "XGuard High-Velocity x402 Facilitator";
    data.description = "Public x402 facilitator for autonomous agents and resource servers: one endpoint, automatic compatible settlement routing, discovery, failover, replay protection and reconciliation.";
    data.version = VERSION;
    data.skills = [
      { id: "xguard-facilitator", name: "x402 facilitator", description: "Use XGuard as the single in-path /verify and /settle endpoint." },
      { id: "xguard-route", name: "automatic x402 route", description: "Select a compatible healthy settlement path for a requested network and scheme." },
      { id: "xguard-discovery", name: "x402 Bazaar discovery", description: "List or search paid resources across reachable discovery catalogs." },
      ...(Array.isArray(data.skills) ? data.skills : []),
    ];
    changed = true;
  }

  if (pathname === "/architecture") {
    data.name = "XGuard High-Velocity x402 Facilitator";
    data.primary_role = "x402 money-path facilitator and automatic settlement router";
    changed = true;
  }

  if (!changed) return response;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers });
}

function llmsText() {
  return `XGuard High-Velocity x402 Facilitator\nPrimary facilitator URL: ${API}\nGET /supported\nPOST /verify\nPOST /settle\nGET /facilitator\nGET /discovery/resources\nGET /discovery/search?query=...\nGET /v1/facilitator/route?network=...&scheme=...\nWell-known discovery: ${API}/.well-known/x402\nMCP: ${API}/mcp\nWebsite: https://xguardgate.com\nXGuard automatically selects a compatible healthy downstream settlement path. Failed settlements are not billed. XGuard never mutates the x402 payTo or signed payment amount.\n`;
}

function skillText() {
  return `# XGuard High-Velocity x402 Facilitator\n\nUse **${API}** as the resource server's x402 facilitator URL.\n\nXGuard aggregates /supported capabilities, selects a compatible healthy route per payment, fails over on transport/rate-limit failures, applies binding/replay controls, and reconciles ambiguous Base USDC settlements.\n\n## Standard money path\n- GET /supported\n- POST /verify\n- POST /settle\n\n## Automatic discovery\n- GET /facilitator\n- GET /discovery/resources\n- GET /discovery/search?query=...\n- GET /v1/facilitator/route?network=...&scheme=...\n- GET /.well-known/x402\n\nThe exact scheme is routed when advertised by healthy upstreams. batch-settlement is advertised/routed only when a healthy configured upstream actually reports support for scheme=batch-settlement.\n`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.protocol === "http:") {
      url.protocol = "https:";
      return harden(new Response(null, { status: 308, headers: { location: url.toString(), "cache-control": "public, max-age=3600" } }));
    }

    if (url.pathname === "/mcp") {
      if (request.method === "POST") return mcp(request, env, ctx);
      if (request.method === "HEAD") return harden(new Response(null, { status: 200, headers: { allow: "POST, HEAD", "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }));
    }

    if (url.pathname === "/llms.txt" && request.method === "GET") return harden(new Response(llmsText(), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=120" } }));
    if (url.pathname === "/skill.md" && request.method === "GET") return harden(new Response(skillText(), { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=120" } }));

    const response = await legacy.fetch(request, env, ctx);
    return harden(await normalizeVersion(response, url.pathname));
  },

  async scheduled(controller, env, ctx) {
    if (typeof legacy.scheduled === "function") return legacy.scheduled(controller, env, ctx);
  },
};
