import app, { handlePaidWebFetch, handlePreflight, issueQuote, recordAgentJourney } from "./webmcp-entry.js";
export * from "./webmcp-entry.js";

const SITE = "https://xguardgate.com";
const API = "https://api.xguardgate.com";
const MCP = `${API}/mcp`;
const VERSION = "5.1.0";
const A2A_VERSION = "1.0.0";
const A2A_SUPPORTED_VERSIONS = new Set(["1.0", "1.0.0"]);
const A2A_ENDPOINT = `${API}/a2a`;

const AGENT_CARD = {
  name: "XGuard Universal Paid AI Agent + Secretless Gateway",
  description: "Discover real XGuard capabilities and prices, obtain a signed x402 quote, and call public or secretless tools without an XGuard account. Paid execution settles before the tool runs and returns a signed receipt plus ProofRail evidence.",
  supportedInterfaces: [
    {
      url: A2A_ENDPOINT,
      protocolBinding: "JSONRPC",
      protocolVersion: A2A_VERSION,
    },
  ],
  provider: {
    url: SITE,
    organization: "XGuard",
  },
  version: VERSION,
  documentationUrl: SITE,
  capabilities: {
    streaming: false,
    pushNotifications: false,
    extendedAgentCard: false,
    extensions: [{
      uri: `${API}/.well-known/payment-manifest`,
      description: "Required x402 v2 payment flow for paid XGuard tools.",
      required: false,
      params: {
        preflight: `${API}/v1/preflight`,
        quote: `${API}/v1/pricing/quote`,
        canonical_quote_body: { url: "https://example.com/", method: "GET", testnet: true },
        price: { amount_atomic: "1000", currency: "USDC", decimals: 6 },
        challenge_status: 402,
        challenge_header: "Payment-Required",
        retry_header: "Payment-Signature",
        settlement_before_execution: true,
      },
    }],
  },
  defaultInputModes: ["text/plain", "application/json"],
  defaultOutputModes: ["text/plain", "application/json"],
  skills: [
    {
      id: "xguard-paid-web-fetch",
      name: "Paid public web fetch",
      description: "Use for one bounded public HTTPS fetch with source evidence at XGuard's guarded-request choke point. Price: 0.001 USDC. Optionally run free xguard.preflight first, then request a signed quote, call the execution URL, handle mandatory HTTP 402, sign Payment-Required with x402 v2, and retry the identical request. XGuard settles before execution and returns a signed receipt plus ProofRail.",
      tags: ["x402", "usdc", "web-fetch", "proofrail"],
      examples: ["POST /v1/pricing/quote with {\"url\":\"https://example.com/\",\"method\":\"GET\",\"testnet\":true}", "After HTTP 402, sign Payment-Required and retry the identical request with Payment-Signature."],
      inputModes: ["text/plain", "application/json"],
      outputModes: ["text/plain", "application/json"],
    },
    {
      id: "xguard-preflight",
      name: "Guarded request preflight",
      description: "Run a free, read-only XGuard preflight before a paid web fetch. It validates HTTPS, SSRF policy, public DNS and payment readiness without contacting the target, then returns the exact quote endpoint and next x402 step.",
      tags: ["preflight", "ssrf", "x402", "web-fetch"],
      examples: ["POST /v1/preflight with {\"url\":\"https://example.com/\",\"testnet\":true}"],
      inputModes: ["text/plain", "application/json"],
      outputModes: ["text/plain", "application/json"],
    },
    {
      id: "xguard-secretless-egress",
      name: "Secretless Agent Egress",
      description: "Discover how an agent can call credential-protected APIs through scoped XGuard capabilities while the reusable credential remains server-side.",
      tags: ["secretless-egress", "credential-security", "ai-agent-security"],
      examples: ["How can my agent call an API without receiving the API key?"],
      inputModes: ["text/plain", "application/json"],
      outputModes: ["text/plain", "application/json"],
    },
    {
      id: "discover-xguard",
      name: "Discover XGuard",
      description: "Return canonical public XGuard discovery endpoints for MCP, OpenAPI, llms.txt, registry manifests and security metadata.",
      tags: ["mcp", "ai-agent-security", "secretless-egress", "developer-tools"],
      examples: ["Where is the canonical XGuard MCP endpoint?", "Give me XGuard machine-readable discovery URLs."],
      inputModes: ["text/plain", "application/json"],
      outputModes: ["text/plain", "application/json"],
    },
    {
      id: "connect-xguard-mcp",
      name: "Connect to XGuard MCP",
      description: "Return the canonical Streamable HTTP MCP endpoint and concise client connection snippets.",
      tags: ["mcp", "streamable-http", "claude", "codex", "cursor"],
      examples: ["How do I connect Claude Code to XGuard?", "What URL should my MCP client use for XGuard?"],
      inputModes: ["text/plain", "application/json"],
      outputModes: ["text/plain", "application/json"],
    },
    {
      id: "explain-secretless-egress",
      name: "Explain Secretless Egress",
      description: "Explain XGuard's secretless credential custody, scoped capabilities and ProofRail execution evidence without performing credential-backed actions.",
      tags: ["credential-security", "api-security", "proofrail", "agent-egress"],
      examples: ["What problem does XGuard Secretless Egress solve?", "What is XGuard ProofRail?"],
      inputModes: ["text/plain", "application/json"],
      outputModes: ["text/plain", "application/json"],
    },
  ],
  iconUrl: `${SITE}/logo.svg`,
};

const PUBLIC_DISCOVERY = {
  name: "XGuard Universal Paid AI Agent + Secretless Gateway",
  version: VERSION,
  website: SITE,
  api: API,
  mcp: MCP,
  transport: "streamable-http",
  official_mcp_registry: "io.github.moelayyan90/xguard-control-plane",
  llms_txt: `${SITE}/llms.txt`,
  mcp_server_card: `${SITE}/.well-known/mcp/server-card.json`,
  mcp_registry_manifest: `${SITE}/server.json`,
  openapi: `${API}/openapi.json`,
  capabilities: `${API}/v1/capabilities`,
  pricing: `${API}/v1/pricing`,
  preflight: `${API}/v1/preflight`,
  signed_quote: `${API}/v1/pricing/quote`,
  quote_request: {
    canonical: { url: "https://example.com/", method: "GET", testnet: true },
    accepted_envelopes: ["flat", "tool+input", "name+arguments", "tool_name+parameters", "function_call"],
  },
  payment_manifest: `${API}/.well-known/payment-manifest`,
  paid_flow: {
    preflight: `${API}/v1/preflight`,
    price: { amount_atomic: "1000", currency: "USDC", decimals: 6 },
    first_execution_status: 402,
    challenge_header: "Payment-Required",
    retry_header: "Payment-Signature",
    settlement_before_execution: true,
    success_artifacts: ["Payment-Response", "signed receipt", "ProofRail evidence"],
  },
  egress_manifest: `${API}/.well-known/xguard-egress.json`,
  proofrail_manifest: `${API}/v1/proof`,
  connect: {
    claude_code: `claude mcp add xguard --transport http ${MCP}`,
    codex: `[mcp_servers.xguard]\nurl = "${MCP}"`,
    cursor_vscode: MCP,
  },
  purpose: "Validate and execute bounded public-HTTPS operations in-path, or keep reusable upstream API credentials outside AI-agent context by using scoped Secretless Egress capabilities.",
  proof_layer: "ProofRail can attach ES256-signed evidence to authorized credential-backed outcomes without placing the reusable upstream secret in the proof.",
  a2a_security_boundary: "A2A SendMessage bridges preflight, signed quote, and paid xguard.web.fetch execution. Paid execution requires x402 settlement before the target is contacted.",
};

function headers(contentType = "application/a2a+json; charset=utf-8") {
  return {
    "content-type": contentType,
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,a2a-version,a2a-extensions,x-request-id,x-xguard-traffic-class,payment-signature,x-xguard-quote,x-xguard-credit",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "x-content-type-options": "nosniff",
    "a2a-version": A2A_VERSION,
    "x-xguard-a2a": "execution-bridge-v1",
  };
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers(), ...extra } });
}

function rpcResult(id, result, status = 200, extra = {}) {
  return json({ jsonrpc: "2.0", id: id ?? null, result }, status, extra);
}

function rpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return json({ jsonrpc: "2.0", id: id ?? null, error }, 200);
}

function discoveryMessage() {
  return {
    messageId: crypto.randomUUID(),
    contextId: crypto.randomUUID(),
    role: "ROLE_AGENT",
    parts: [{ text: JSON.stringify(PUBLIC_DISCOVERY) }],
  };
}

function parseTextPart(part) {
  if (!part || typeof part !== "object" || typeof part.text !== "string") return null;
  const value = part.text.trim();
  if (!value) return null;
  try { return JSON.parse(value); } catch { return value; }
}

function a2aIntent(message) {
  for (const part of message.parts || []) {
    if (part?.data && typeof part.data === "object") return part.data;
    const parsed = parseTextPart(part);
    if (parsed && typeof parsed === "object") return parsed;
  }
  return null;
}

function a2aMessage(value) {
  return {
    messageId: crypto.randomUUID(),
    contextId: crypto.randomUUID(),
    role: "ROLE_AGENT",
    parts: [{ data: value }],
  };
}

function paymentHeaders(request) {
  const headers = new Headers({ "content-type": "application/json", "x-xguard-traffic-class": request.headers.get("x-xguard-traffic-class") || "external" });
  for (const name of ["payment-signature", "x-xguard-quote", "x-xguard-credit", "x-request-id"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

async function bridgeIntent(request, env, id, intent) {
  const action = String(intent?.action || intent?.operation || intent?.tool || intent?.name || "").toLowerCase();
  const input = intent?.input || intent?.arguments || intent?.parameters || intent;
  const observation = { trafficClass: request.headers.get("x-xguard-traffic-class") || "external", transport: "a2a" };
  if (["preflight", "xguard.preflight", "xguard_preflight"].includes(action)) {
    const response = await handlePreflight(env, input, id, observation);
    const value = await response.clone().json();
    return rpcResult(intent.rpc_id, { message: a2aMessage(value), status: response.ok ? "COMPLETED" : "FAILED" }, response.status);
  }
  if (["quote", "pricing.quote", "xguard.pricing.quote", "xguard_pricing_quote"].includes(action)) {
    const quoted = await issueQuote(env, input, id, observation);
    const value = await quoted.response.clone().json();
    return rpcResult(intent.rpc_id, { message: a2aMessage(value), status: quoted.response.ok ? "COMPLETED" : "FAILED" }, quoted.response.status);
  }
  if (["xguard.web.fetch", "xguard_web_fetch", "guarded_execute", "xguard_guarded_execute", "web.fetch", "fetch"].includes(action)) {
    const testnet = input?.testnet === true || intent?.testnet === true;
    const path = testnet ? "/v1/tools/web.fetch/testnet" : "/v1/tools/web.fetch";
    const paidRequest = new Request(`${API}${path}`, { method: "POST", headers: paymentHeaders(request), body: JSON.stringify(input) });
    const paid = await handlePaidWebFetch(paidRequest, env, id, input, testnet, "a2a");
    const value = await paid.clone().json().catch(() => ({ error: "invalid_gateway_response" }));
    const exposed = {};
    for (const name of ["payment-required", "payment-response", "x-xguard-payment-environment", "x-xguard-payment-rail", "x-xguard-payment-identifier", "x-xguard-replay", "x-xguard-proof", "x-xguard-receipt"]) {
      const header = paid.headers.get(name);
      if (header) exposed[name] = header;
    }
    const state = paid.status === 402 ? "INPUT_REQUIRED" : paid.ok ? "COMPLETED" : "FAILED";
    return rpcResult(intent.rpc_id, { message: a2aMessage(value), status: state, payment: exposed }, paid.status, exposed);
  }
  return null;
}

function a2aRequestId(request) {
  const supplied = request.headers.get("x-request-id");
  if (supplied && /^[A-Za-z0-9_-]{8,128}$/.test(supplied)) return supplied;
  return `xgr_${crypto.randomUUID().replaceAll("-", "")}`;
}

async function handleA2A(request, env) {
  const id = a2aRequestId(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers() });
  if (request.method === "GET" || request.method === "HEAD") {
    if (request.method === "GET") await recordAgentJourney(request, env, "discovery", { request_id: id, transport: "a2a", surface: "a2a" });
    return new Response(request.method === "HEAD" ? null : JSON.stringify({ agent_card: AGENT_CARD, discovery: PUBLIC_DISCOVERY }), { status: 200, headers: { ...headers(), "x-xguard-request-id": id } });
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST, OPTIONS" });

  const requestedVersion = request.headers.get("a2a-version");
  if (requestedVersion && !A2A_SUPPORTED_VERSIONS.has(requestedVersion)) {
    return rpcError(null, -32009, "Version not supported", { supported: [...A2A_SUPPORTED_VERSIONS], requested: requestedVersion });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  if (!body || body.jsonrpc !== "2.0" || !("id" in body) || typeof body.method !== "string") {
    return rpcError(body?.id ?? null, -32600, "Invalid Request");
  }

  if (body.method === "GetExtendedAgentCard") {
    return rpcError(body.id, -32007, "Extended Agent Card not configured");
  }

  if (body.method !== "SendMessage") {
    return rpcError(body.id, -32004, "Unsupported operation", { supported: ["SendMessage"] });
  }

  const message = body.params?.message;
  if (!message || typeof message.messageId !== "string" || !message.messageId || message.role !== "ROLE_USER" || !Array.isArray(message.parts) || message.parts.length === 0) {
    return rpcError(body.id, -32602, "Invalid params");
  }

  const intent = a2aIntent(message);
  if (intent && typeof intent === "object") {
    const bridged = await bridgeIntent(request, env, id, { ...intent, rpc_id: body.id });
    if (bridged) {
      const responseHeaders = new Headers(bridged.headers);
      responseHeaders.set("x-xguard-request-id", id);
      return new Response(bridged.body, { status: bridged.status, headers: responseHeaders });
    }
  }
  await recordAgentJourney(request, env, "discovery", { request_id: id, transport: "a2a", surface: "send_message", drop_reason: intent ? "no_matching_capability" : undefined });
  const response = rpcResult(body.id, { message: discoveryMessage() });
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("x-xguard-request-id", id);
  return new Response(response.body, { status: response.status, headers: responseHeaders });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if ((request.method === "GET" || request.method === "HEAD") && (url.pathname === "/.well-known/agent-card.json" || url.pathname === "/.well-known/agent.json")) {
      const id = a2aRequestId(request);
      if (request.method === "GET") await recordAgentJourney(request, env, "discovery", { request_id: id, transport: "a2a", surface: "agent_card" });
      return request.method === "HEAD"
        ? new Response(null, { status: 200, headers: { ...headers(), "cache-control": "public, max-age=300", "content-type": "application/a2a+json; charset=utf-8", "x-xguard-request-id": id } })
        : json(AGENT_CARD, 200, { "cache-control": "public, max-age=300", "content-type": "application/a2a+json; charset=utf-8", "x-xguard-request-id": id });
    }

    if (url.pathname === "/a2a") return handleA2A(request, env);

    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  },
};
