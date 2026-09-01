import app from "./discovery-entry.js";
export * from "./discovery-entry.js";

const SITE = "https://xguardgate.com";
const API = "https://api.xguardgate.com";
const MCP = `${API}/mcp`;
const REPO = "https://github.com/moelayyan90/XGuard";

function webMcpBootstrap() {
  const discovery = JSON.stringify({
    name: "XGuard Universal Paid AI Agent + Secretless Gateway",
    site: SITE,
    api: API,
    mcp: MCP,
    repository: REPO,
    official_registry_name: "io.github.moelayyan90/xguard-control-plane",
    llms: `${SITE}/llms.txt`,
    server_card: `${SITE}/.well-known/mcp/server-card.json`,
    server_manifest: `${SITE}/server.json`,
    openapi: `${API}/openapi.json`,
    egress_manifest: `${API}/.well-known/xguard-egress.json`,
    proof_manifest: `${API}/v1/proof`,
    capabilities: `${API}/v1/capabilities`,
    pricing: `${API}/v1/pricing`,
    payment_manifest: `${API}/.well-known/payment-manifest`,
  }).replace(/</g, "\\u003c");

  const connect = JSON.stringify({
    transport: "streamable-http",
    endpoint: MCP,
    claude_code: `claude mcp add xguard --transport http ${MCP}`,
    codex: `[mcp_servers.xguard]\\nurl = \"${MCP}\"`,
    cursor_vscode: MCP,
  }).replace(/</g, "\\u003c");

  const purpose = JSON.stringify({
    primary_product: "Universal Paid AI Agent + Secretless Gateway",
    summary: "Discover real tools, obtain signed prices, pay per request with x402 USDC, and receive signed receipts. Secretless connectors keep reusable upstream credentials outside AI-agent context.",
    proof_layer: "ProofRail",
    supported_examples: ["OpenAI", "Anthropic", "GitHub", "Stripe", "generic public HTTPS APIs"],
    security_boundary: "The browser tools on this page are discovery-only and do not provision credentials, spend credits, mutate accounts, or execute upstream side effects.",
  }).replace(/</g, "\\u003c");

  return `<script id="xguard-webmcp">(() => {
    const mc = document.modelContext;
    if (!mc || typeof mc.registerTool !== "function") return;
    const safeRegister = (tool) => Promise.resolve(mc.registerTool(tool)).catch(() => undefined);
    const readOnly = { readOnlyHint: true, untrustedContentHint: false };
    const emptyInput = { type: "object", properties: {}, additionalProperties: false };

    safeRegister({
      name: "xguard_discover",
      title: "Discover XGuard",
      description: "Return XGuard's canonical public MCP, API, registry, OpenAPI, llms.txt and machine-discovery endpoints. Read-only and no account action is performed.",
      inputSchema: emptyInput,
      annotations: readOnly,
      execute: async () => ${JSON.stringify(discovery)}
    });

    safeRegister({
      name: "xguard_connect_mcp",
      title: "Connect to XGuard MCP",
      description: "Return the canonical remote MCP endpoint and connection snippets for common MCP clients. Read-only; this does not install or configure anything automatically.",
      inputSchema: emptyInput,
      annotations: readOnly,
      execute: async () => ${JSON.stringify(connect)}
    });

    safeRegister({
      name: "xguard_explain_secretless_egress",
      title: "Explain XGuard Secretless Egress",
      description: "Return a concise machine-readable explanation of XGuard Secretless Egress and ProofRail, including the security boundary of the browser tools. Read-only.",
      inputSchema: emptyInput,
      annotations: readOnly,
      execute: async () => ${JSON.stringify(purpose)}
    });
  })();</script>`;
}

async function injectWebMcp(response) {
  if (!(response instanceof Response) || !response.ok) return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  const html = await response.clone().text();
  if (html.includes('id="xguard-webmcp"') || !html.includes("</body>")) return response;

  const body = html.replace("</body>", `${webMcpBootstrap()}</body>`);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("x-xguard-webmcp", "imperative-readonly-v1");
  headers.set("permissions-policy", "tools=(self)");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    let response = await app.fetch(request, env, ctx);
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") response = await injectWebMcp(response);
    return response;
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  },
};
