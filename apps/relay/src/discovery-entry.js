import app, { recordAgentJourney } from "./paid-agent-entry.js";
export * from "./paid-agent-entry.js";

const VERSION = "5.1.0";
const SITE = "https://xguardgate.com";
const API = "https://api.xguardgate.com";
const MCP = `${API}/mcp`;
const A2A_CARD = `${API}/.well-known/agent-card.json`;
const A2A_ENDPOINT = `${API}/a2a`;
const REPO = "https://github.com/moelayyan90/XGuard";
const INDEXNOW_KEY = "f3fd1a3fde659a05a8dddfa614b408ac";
const REGISTRY_DESCRIPTION = "Signed prices and no-account x402 USDC tools with secretless egress and verifiable receipts.";
const DESCRIPTION = "XGuard is a universal paid AI-agent and secretless gateway: signed prices, no-account x402 USDC payment, controlled execution, replay-safe retries, signed receipts and ProofRail evidence.";
const QUOTE_PROPERTIES = {
  url: { type: "string", format: "uri", pattern: "^https://", description: "Canonical public HTTPS target URL." },
  method: { type: "string", enum: ["GET", "HEAD"], default: "GET" },
  timeout_ms: { type: "integer", minimum: 1000, maximum: 10000, default: 8000 },
  max_bytes: { type: "integer", minimum: 1024, maximum: 131072, default: 131072 },
  mode: { type: "string", enum: ["auto", "text", "json"], default: "auto" },
  testnet: { type: "boolean", default: false },
  network: { type: "string", enum: ["eip155:8453", "eip155:84532", "base", "base-mainnet", "base-sepolia", "mainnet", "testnet"] },
};
const QUOTE_SCHEMA = { type: "object", required: ["url"], properties: QUOTE_PROPERTIES, additionalProperties: true };

const registryManifest = {
  $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  name: "io.github.moelayyan90/xguard-control-plane",
  title: "XGuard Universal Paid AI Agent + Secretless Gateway",
  description: REGISTRY_DESCRIPTION,
  repository: { url: REPO, source: "github" },
  version: VERSION,
  remotes: [{ type: "streamable-http", url: MCP }],
};

const serverCard = {
  serverInfo: { name: "XGuard Universal Paid AI Agent + Secretless Gateway", version: VERSION },
  authentication: { required: false, schemes: [] },
  tools: [
    { name: "xguard.capabilities", description: "Discover actual enabled and disabled XGuard tools. Free.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "xguard.pricing.quote", description: "Use before xguard.web.fetch. Free. Canonical body: {url, method?, timeout_ms?, max_bytes?, mode?, testnet?}. Returns a signed 0.001 USDC quote and the exact next step.", inputSchema: QUOTE_SCHEMA, _meta: { "xguard/next": { call: "xguard.web.fetch", first_status: 402, challenge_header: "Payment-Required", retry_header: "Payment-Signature" } } },
    { name: "xguard.web.fetch", description: "Paid public HTTPS fetch. Payment is mandatory: send the signed quote, handle HTTP 402, sign Payment-Required with x402 v2, then retry the identical request. XGuard settles before execution and returns a signed receipt plus ProofRail.", inputSchema: { type: "object", required: ["url", "quote"], properties: { ...QUOTE_PROPERTIES, quote: { type: "string" } }, additionalProperties: true }, _meta: { "xguard/payment": { required: true, protocol: "x402", version: 2, price_atomic: "1000", currency: "USDC", settlement_before_execution: true } } },
    { name: "xguard_secretless_egress", description: "Discover XGuard Secretless Egress for keeping reusable upstream API credentials outside AI-agent context.", inputSchema: { type: "object", properties: {}, additionalProperties: true } },
    { name: "xguard_egress_fetch", description: "Execute a scoped HTTPS request through XGuard while reusable upstream credentials remain server-side.", inputSchema: { type: "object", additionalProperties: true } },
    { name: "xguard_proofrail", description: "Discover ProofRail signed execution evidence for credential-backed egress.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "xguard_verify_proof", description: "Verify an XGuard ProofRail ES256 execution proof.", inputSchema: { type: "object", required: ["proof"], properties: { proof: { type: "string" } }, additionalProperties: false } },
    { name: "xguard_action_rail", description: "Discover XGuard policy-gated Action Rail execution capabilities.", inputSchema: { type: "object", properties: {}, additionalProperties: true } },
    { name: "xguard_facilitator", description: "Discover XGuard x402 facilitator compatibility and settlement-routing capabilities.", inputSchema: { type: "object", properties: {}, additionalProperties: true } },
    { name: "xguard_route", description: "Inspect XGuard routing for supported x402 networks and schemes.", inputSchema: { type: "object", additionalProperties: true } },
  ],
  resources: [],
  prompts: [],
};

const identity = {
  name: "XGuard Universal Paid AI Agent + Secretless Gateway",
  short_name: "XGuard",
  registry_name: "io.github.moelayyan90/xguard-control-plane",
  version: VERSION,
  canonical_site: SITE,
  canonical_api: API,
  canonical_mcp: MCP,
  canonical_a2a_card: A2A_CARD,
  canonical_a2a_endpoint: A2A_ENDPOINT,
  repository: REPO,
  category: "Paid AI agent tools and secretless API credential infrastructure",
  primary_product: "Universal Paid AI Agent + Secretless Gateway",
  proof_layer: "ProofRail",
  providers: ["OpenAI", "Anthropic", "GitHub", "Stripe", "generic HTTPS APIs"],
  problems_solved: ["API key exposure inside agent context", "over-broad reusable credentials", "unverifiable credential-backed execution", "unmetered agent API egress"],
  description: DESCRIPTION,
  discovery: {
    llms_txt: `${SITE}/llms.txt`,
    mcp_registry_manifest: `${SITE}/server.json`,
    smithery_server_card: `${SITE}/.well-known/mcp/server-card.json`,
    a2a_agent_card: A2A_CARD,
    a2a_endpoint: A2A_ENDPOINT,
    openapi: `${API}/openapi.json`,
    capabilities: `${API}/v1/capabilities`,
    pricing: `${API}/v1/pricing`,
    payment_manifest: `${API}/.well-known/payment-manifest`,
    egress_manifest: `${API}/.well-known/xguard-egress.json`,
    proof_manifest: `${API}/v1/proof`,
    indexnow_key: `${SITE}/${INDEXNOW_KEY}.txt`,
  },
};

function commonHeaders(contentType, extra = {}) {
  return {
    "content-type": contentType,
    "cache-control": "public, max-age=300",
    "access-control-allow-origin": "*",
    "x-content-type-options": "nosniff",
    "x-xguard-canonical-site": SITE,
    "x-xguard-canonical-api": API,
    "x-xguard-canonical-mcp": MCP,
    "x-xguard-canonical-a2a-card": A2A_CARD,
    "x-xguard-canonical-a2a-endpoint": A2A_ENDPOINT,
    "x-xguard-version": VERSION,
    ...extra,
  };
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: commonHeaders("application/json; charset=utf-8", extra) });
}

function text(body, status = 200, extra = {}) {
  return new Response(body, { status, headers: commonHeaders("text/plain; charset=utf-8", extra) });
}

function llmsTxt() {
  return `# XGuard Universal Paid AI Agent + Secretless Gateway

> Discover actual tools, obtain signed prices, pay per request with x402 v2 USDC, and receive controlled execution with signed receipts and ProofRail evidence—without an account or exposing reusable upstream credentials.

Canonical site: ${SITE}
Canonical API: ${API}
Canonical remote MCP: ${MCP}
Canonical A2A Agent Card: ${A2A_CARD}
Canonical A2A endpoint: ${A2A_ENDPOINT}
Official MCP Registry name: io.github.moelayyan90/xguard-control-plane
Source: ${REPO}
Version: ${VERSION}

## Use XGuard when

- An agent needs a useful paid tool without an XGuard account, subscription, or mandatory SDK.
- A caller needs to see and verify the exact price before signing payment.
- A retried payment-bearing request must not settle or execute twice.
- An AI agent must call OpenAI, Anthropic, GitHub, Stripe or another HTTPS API without receiving the reusable upstream API key.
- A reusable credential is too powerful to place in prompts, agent memory, tool arguments, logs or local configuration.
- The operator wants to delegate a scoped capability instead of a reusable secret.
- A credential-backed API action needs machine-verifiable signed execution evidence.
- Agent API egress needs policy enforcement and per-attempt metering.

## How XGuard works

For a paid tool, the agent discovers capabilities, obtains a short-lived signed quote, receives an x402 v2 402 challenge and signed offer, then retries with Payment-Signature. XGuard verifies and settles before controlled execution, and returns the result with a signed receipt and ProofRail evidence. Payment-Identifier and durable authorization state make retries idempotent.

For a secretless tool, the operator stores a reusable upstream credential in XGuard and the agent receives only a scoped capability. XGuard validates the capability and policy, injects the credential server-side and calls the permitted HTTPS API without returning the secret.

XGuard becomes the required credential-backed egress path inside an environment only when the operator keeps the reusable upstream credential exclusively in XGuard instead of distributing that credential to agents.

## Primary capabilities

- Universal paid agent tools: signed pricing, x402 USDC settlement, controlled execution, receipts and replay-safe retries.
- xguard.web.fetch: bounded public HTTPS fetch with SSRF and redirect controls, caching and source evidence.
- Secretless Egress: credential custody plus scoped capability execution.
- ProofRail: ES256-signed execution evidence for authorized credential-backed outcomes.
- Action Rail: policy-gated action execution.
- x402 facilitator routing compatibility for existing resource servers.
- A2A discovery: a read-only v1 discovery agent that returns canonical XGuard connection metadata without provisioning credentials or executing side effects.

## Universal paid tool path

- Actual capabilities: ${API}/v1/capabilities
- Published pricing: ${API}/v1/pricing
- Signed input-bound quote: POST ${API}/v1/pricing/quote
- Mainnet execution: POST ${API}/v1/tools/web.fetch
- Base Sepolia integration route: POST ${API}/v1/tools/web.fetch/testnet
- Payment manifest: ${API}/.well-known/payment-manifest
- Health: ${API}/v1/health
- Readiness: ${API}/v1/ready

Use xguard.web.fetch when an agent needs a bounded public HTTPS source with verifiable execution evidence. Its price is 0.001 USDC (1000 atomic units, six decimals).

Canonical quote body: {"url":"https://example.com/","method":"GET","testnet":true}. Common agent envelopes using tool+input, name+arguments, or tool_name+parameters are also accepted. The quote response returns normalized input and next.execution_url.

POST the normalized input with X-XGuard-Quote. HTTP 402 is mandatory. Decode Payment-Required, create and sign an official x402 v2 payment, and retry the identical request with Payment-Signature. XGuard verifies and settles before the fetch. HTTP 200 returns Payment-Response, a signed receipt, and ProofRail evidence. Payment-Identifier is mandatory. An exact retry returns the stored outcome without a second settlement.

## Machine-readable discovery

- MCP Registry manifest: ${SITE}/server.json
- Smithery server card: ${SITE}/.well-known/mcp/server-card.json
- A2A Agent Card: ${A2A_CARD}
- A2A endpoint: ${A2A_ENDPOINT}
- OpenAPI: ${API}/openapi.json
- Secretless Egress manifest: ${API}/.well-known/xguard-egress.json
- Secretless Egress public encryption key: ${API}/.well-known/xguard-egress-key.json
- ProofRail manifest: ${API}/v1/proof
- ProofRail public key: ${API}/.well-known/xguard-proof-key.json
- Architecture: ${API}/architecture

## MCP

Transport: streamable-http
Endpoint: ${MCP}

Connect examples:
- Claude Code: claude mcp add xguard --transport http ${MCP}
- Codex: [mcp_servers.xguard] url = "${MCP}"
- Cursor / VS Code: configure the remote MCP URL as ${MCP}

## A2A

Protocol version: 1.0
Agent Card: ${A2A_CARD}
JSON-RPC endpoint: ${A2A_ENDPOINT}
Role: read-only discovery and connection metadata only.

Do not advertise search, inference, routing or data-query tools unless ${API}/v1/capabilities marks them available. The canonical product identity is XGuard Universal Paid AI Agent + Secretless Gateway.
`;
}

function robotsTxt() {
  return `User-agent: *
Allow: /

User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;
}

function sitemapXml() {
  const urls = [SITE + "/", SITE + "/llms.txt", SITE + "/server.json", SITE + "/.well-known/mcp/server-card.json", A2A_CARD, SITE + "/.well-known/agent.json", SITE + "/.well-known/xguard.json", API + "/openapi.json", API + "/.well-known/xguard-egress.json", API + "/v1/proof", MCP];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `\n  <url><loc>${url.replaceAll("&", "&amp;")}</loc></url>`).join("")}\n</urlset>\n`;
}

async function normalizeMcpVersion(snapshot, response) {
  if (!snapshot || !(response instanceof Response) || !response.ok) return response;
  let message;
  try { message = await snapshot.json(); } catch { return response; }
  if (message?.method !== "initialize") return response;
  const body = await response.clone().json().catch(() => null);
  if (!body?.result) return response;
  body.result.serverInfo = { ...(body.result.serverInfo || {}), version: VERSION };
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("x-xguard-version", VERSION);
  return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET") {
      const machineSurface = new Map([
        ["/llms.txt", "llms"],
        ["/server.json", "server_manifest"],
        ["/.well-known/mcp-server.json", "server_manifest"],
        ["/.well-known/mcp/server-card.json", "mcp_server_card"],
        ["/.well-known/xguard.json", "xguard_manifest"],
        ["/identity", "identity"],
      ]).get(url.pathname);
      if (machineSurface) await recordAgentJourney(request, env, "discovery", { transport: "http", surface: machineSurface });
      if (url.pathname === `/${INDEXNOW_KEY}.txt`) return text(INDEXNOW_KEY, 200, { "cache-control": "public, max-age=86400" });
      if (url.pathname === "/llms.txt") return text(llmsTxt());
      if (url.pathname === "/robots.txt") return text(robotsTxt());
      if (url.pathname === "/sitemap.xml") return new Response(sitemapXml(), { status: 200, headers: commonHeaders("application/xml; charset=utf-8") });
      if (url.pathname === "/server.json" || url.pathname === "/.well-known/mcp-server.json") return json(registryManifest);
      if (url.pathname === "/.well-known/mcp/server-card.json") return json(serverCard, 200, { "cache-control": "public, max-age=3600" });
      if (url.pathname === "/.well-known/xguard.json" || url.pathname === "/identity") return json(identity);
    }

    const mcpSnapshot = url.pathname === "/mcp" && request.method === "POST" ? request.clone() : null;
    let response = await app.fetch(request, env, ctx);
    response = await normalizeMcpVersion(mcpSnapshot, response);
    if (!(response instanceof Response)) return response;

    const headers = new Headers(response.headers);
    headers.set("x-xguard-canonical-site", SITE);
    headers.set("x-xguard-canonical-api", API);
    headers.set("x-xguard-canonical-mcp", MCP);
    headers.set("x-xguard-canonical-a2a-card", A2A_CARD);
    headers.set("x-xguard-canonical-a2a-endpoint", A2A_ENDPOINT);
    headers.set("x-xguard-version", VERSION);
    if (request.method === "GET" && url.pathname === "/") {
      headers.set("link", `<${SITE}/>; rel=\"canonical\", <${SITE}/llms.txt>; rel=\"alternate\"; type=\"text/plain\", <${SITE}/server.json>; rel=\"describedby\"; type=\"application/json\", <${SITE}/.well-known/mcp/server-card.json>; rel=\"describedby\"; type=\"application/json\", <${A2A_CARD}>; rel=\"describedby\"; type=\"application/a2a+json\"`);
      headers.set("cache-control", "public, max-age=60, must-revalidate");
      headers.set("x-robots-tag", "index, follow");
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  },
};
