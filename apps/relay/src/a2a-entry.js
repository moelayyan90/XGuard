import app from "./webmcp-entry.js";
export * from "./webmcp-entry.js";

const SITE = "https://xguardgate.com";
const API = "https://api.xguardgate.com";
const MCP = `${API}/mcp`;
const VERSION = "5.0.2";
const A2A_VERSION = "1.0";
const A2A_ENDPOINT = `${SITE}/a2a`;

const AGENT_CARD = {
  name: "XGuard Secretless Agent Gateway",
  description: "Read-only discovery agent for XGuard Secretless Agent Gateway. It tells other agents where XGuard's canonical MCP, API, OpenAPI, llms.txt, registry metadata and security manifests are, and explains how to connect without provisioning credentials or executing side effects.",
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
  },
  defaultInputModes: ["text/plain", "application/json"],
  defaultOutputModes: ["text/plain", "application/json"],
  skills: [
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
  name: "XGuard Secretless Agent Gateway",
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
  egress_manifest: `${API}/.well-known/xguard-egress.json`,
  proofrail_manifest: `${API}/v1/proof`,
  connect: {
    claude_code: `claude mcp add xguard --transport http ${MCP}`,
    codex: `[mcp_servers.xguard]\nurl = "${MCP}"`,
    cursor_vscode: MCP,
  },
  purpose: "Keep reusable upstream API credentials outside AI-agent context by letting operators retain reusable secrets server-side and delegate short-lived scoped capabilities instead.",
  proof_layer: "ProofRail can attach ES256-signed evidence to authorized credential-backed outcomes without placing the reusable upstream secret in the proof.",
  a2a_security_boundary: "This A2A surface is discovery-only. It does not provision credentials, consume XGuard Usage Credits, mutate accounts, or execute upstream side effects.",
};

function headers(contentType = "application/a2a+json; charset=utf-8") {
  return {
    "content-type": contentType,
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,a2a-version,a2a-extensions",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "x-content-type-options": "nosniff",
    "a2a-version": A2A_VERSION,
    "x-xguard-a2a": "discovery-readonly-v1",
  };
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers(), ...extra } });
}

function rpcResult(id, result) {
  return json({ jsonrpc: "2.0", id: id ?? null, result });
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

async function handleA2A(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers() });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST, OPTIONS" });

  const requestedVersion = request.headers.get("a2a-version");
  if (requestedVersion && requestedVersion !== A2A_VERSION) {
    return rpcError(null, -32009, "Version not supported", { supported: [A2A_VERSION], requested: requestedVersion });
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

  return rpcResult(body.id, { message: discoveryMessage() });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/.well-known/agent-card.json" || url.pathname === "/.well-known/agent.json")) {
      return json(AGENT_CARD, 200, { "cache-control": "public, max-age=300", "content-type": "application/a2a+json; charset=utf-8" });
    }

    if (url.pathname === "/a2a") return handleA2A(request);

    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  },
};
