import legacy from "./entry.js";

export { MerchantQuota, SettlementReceipt, AgentAuthority } from "./entry.js";

const API = "https://api.xguardgate.com";
const VERSION = "4.1.0";
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
    name: "xguard_safety_test",
    description: "Score a transaction sample without contacting its target. Example: target='https://example.com/pay', method='POST'.",
    inputSchema: TRANSACTION_INPUT,
    outputSchema: OUTPUT_SCHEMA,
    annotations: { ...CLOSED_READ_ONLY, title: "XGuard Safety Test" },
  },
  {
    name: "xguard_protocols",
    description: "List transaction protocols and edge surfaces recognized by XGuard. Example: call before choosing an integration rail.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: OUTPUT_SCHEMA,
    annotations: { ...CLOSED_READ_ONLY, title: "XGuard Protocols" },
  },
  {
    name: "xguard_inspect",
    description: "Classify and policy-check a transaction without forwarding it. Example: inspect a POST to https://example.com/checkout.",
    inputSchema: TRANSACTION_INPUT,
    outputSchema: OUTPUT_SCHEMA,
    annotations: { ...CLOSED_READ_ONLY, title: "XGuard Inspect" },
  },
  {
    name: "xguard_health",
    description: "Return XGuard control-plane and facilitator health. Example: call before routing a settlement.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: OUTPUT_SCHEMA,
    annotations: { ...OPEN_READ_ONLY, title: "XGuard Health" },
  },
  {
    name: "xguard_supported",
    description: "Return currently supported x402 payment kinds. Example: call before selecting an x402 payment kind.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: OUTPUT_SCHEMA,
    annotations: { ...OPEN_READ_ONLY, title: "XGuard Supported Payments" },
  },
  {
    name: "xguard_receipt",
    description: "Look up a durable XGuard settlement receipt. Example: receipt_id='xgr_0123456789abcdef0123456789abcdef01234567'.",
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
    description: "Return XGuard integration, security controls and pricing. Example: call when configuring an agent or merchant.",
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
  if (data && typeof data === "object" && !Array.isArray(data) && Object.prototype.hasOwnProperty.call(data, "version")) {
    data.version = VERSION;
  }
  if (data?.info && typeof data.info === "object" && Object.prototype.hasOwnProperty.call(data.info, "version")) {
    data.info.version = VERSION;
  }
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
        serverInfo: { name: "xguard-control-plane", version: VERSION },
      },
    });
  }

  if (message.method === "notifications/initialized") {
    return harden(new Response(null, { status: 204 }));
  }

  if (message.method === "tools/list") {
    return json({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  }

  if (message.method !== "tools/call") {
    return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  }

  const name = message.params?.name;
  const args = message.params?.arguments || {};
  let result;

  if (name === "xguard_safety_test") {
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
    if (!/^xgr_[a-f0-9]{40}$/.test(receiptId)) {
      return json({ jsonrpc: "2.0", id, result: mcpResult({ error: "invalid_receipt_id" }, true) });
    }
    result = await legacyJson(`/v1/receipts/${receiptId}`, env, ctx);
  } else if (name === "xguard_integration") {
    result = await legacyJson("/docs", env, ctx);
  } else {
    return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unknown tool" } });
  }

  return json({
    jsonrpc: "2.0",
    id,
    result: mcpResult(result.data, !result.response.ok),
  });
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
  if (!changed) return response;

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(data), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.protocol === "http:") {
      url.protocol = "https:";
      return harden(new Response(null, {
        status: 308,
        headers: { location: url.toString(), "cache-control": "public, max-age=3600" },
      }));
    }

    if (url.pathname === "/mcp") {
      if (request.method === "POST") return mcp(request, env, ctx);
      if (request.method === "HEAD") {
        return harden(new Response(null, {
          status: 200,
          headers: {
            allow: "POST, HEAD",
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        }));
      }
    }

    const response = await legacy.fetch(request, env, ctx);
    return harden(await normalizeVersion(response, url.pathname));
  },

  async scheduled(controller, env, ctx) {
    if (typeof legacy.scheduled === "function") return legacy.scheduled(controller, env, ctx);
  },
};