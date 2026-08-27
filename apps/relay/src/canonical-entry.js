import app from "./a2a-entry.js";
export * from "./a2a-entry.js";

const VERSION = "5.0.2";
const SITE = "https://xguardgate.com";
const API = "https://api.xguardgate.com";
const MCP = `${API}/mcp`;
const NAME = "XGuard Secretless Agent Gateway";
const PRIMARY_PRODUCT = "Secretless Egress";
const PRIMARY_ROLE = "credential broker and controlled egress boundary for AI agents";
const DESCRIPTION = "Protect AI agents from API-key exposure with encrypted reusable credential custody, short-lived scoped capabilities, server-side credential injection, Usage Credit metering and ProofRail signed execution evidence.";

const PUBLIC_JSON = new Set([
  "/docs",
  "/architecture",
  "/openapi.json",
  "/.well-known/xguard.json",
  "/.well-known/ai-plugin.json",
  "/.well-known/agent-card.json",
  "/.well-known/agent.json",
  "/facilitator",
  "/.well-known/x402",
  "/.well-known/x402.json",
  "/.well-known/x402-facilitator.json",
]);

const X402_DISCOVERY = new Set([
  "/facilitator",
  "/.well-known/x402",
  "/.well-known/x402.json",
  "/.well-known/x402-facilitator.json",
]);

function canonicalIdentity() {
  return {
    name: NAME,
    version: VERSION,
    primary_product: PRIMARY_PRODUCT,
    primary_role: PRIMARY_ROLE,
    site: SITE,
    api: API,
    mcp: MCP,
  };
}

function baseHeaders(headers = new Headers()) {
  const next = new Headers(headers);
  next.set("x-xguard-version", VERSION);
  next.set("x-xguard-canonical-name", NAME);
  next.set("x-xguard-primary-product", "secretless-egress");
  next.set("x-xguard-canonical-site", SITE);
  next.set("x-xguard-canonical-api", API);
  next.set("x-xguard-canonical-mcp", MCP);
  next.set("x-content-type-options", "nosniff");
  return next;
}

function permanentRedirect(location) {
  return new Response(null, {
    status: 308,
    headers: baseHeaders(new Headers({
      location,
      "cache-control": "public, max-age=86400",
    })),
  });
}

function canonicalizeUrl(request) {
  const url = new URL(request.url);
  if (url.hostname === "www.xguardgate.com") {
    return permanentRedirect(`${SITE}${url.pathname}${url.search}`);
  }
  if (url.protocol === "http:") {
    url.protocol = "https:";
    return permanentRedirect(url.toString());
  }
  return null;
}

function apiRoot(request) {
  const body = {
    ...canonicalIdentity(),
    description: DESCRIPTION,
    discovery: {
      secretless_egress: `${API}/v1/egress`,
      egress_manifest: `${API}/.well-known/xguard-egress.json`,
      proofrail: `${API}/v1/proof`,
      openapi: `${API}/openapi.json`,
      mcp: MCP,
      llms: `${SITE}/llms.txt`,
    },
    compatibility_rails: {
      action_rail: `${API}/v1/actions`,
      x402: `${API}/facilitator`,
    },
  };
  return new Response(request.method === "HEAD" ? null : JSON.stringify(body, null, 2), {
    status: 200,
    headers: baseHeaders(new Headers({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=120",
    })),
  });
}

function connectPage(request) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect XGuard — Secretless Agent Gateway</title><meta name="description" content="Connect AI agents to XGuard Secretless Egress and ProofRail through the canonical remote MCP endpoint."><meta name="robots" content="index,follow"><link rel="canonical" href="${SITE}/connect"><style>body{margin:0;background:#0b0b0b;color:#f7f7f3;font-family:Arial,Helvetica,sans-serif}.w{width:min(920px,calc(100% - 32px));margin:auto;padding:64px 0}h1{font-size:clamp(44px,7vw,76px);letter-spacing:-.055em;line-height:.95;margin:16px 0 24px}.muted{color:#a8a8a1;line-height:1.7}.badge{display:inline-block;border:1px solid #4a4a45;padding:7px 11px;font-size:12px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-top:34px}.c{border:1px solid #30302d;background:#131311;padding:22px}.c h2{margin-top:0;font-size:18px}.orange{color:#ff5a1f}.btn{display:inline-block;margin-top:10px;padding:11px 14px;background:#ff5a1f;color:#fff;text-decoration:none;font-weight:700}pre{white-space:pre-wrap;background:#070707;border:1px solid #30302d;padding:13px;color:#e8e8e2;overflow:auto}.notice{margin-top:32px;border-left:3px solid #ff5a1f;padding:8px 0 8px 16px;color:#bdbdb6;line-height:1.65}.foot{margin-top:34px;color:#77776f;font-size:12px}@media(max-width:680px){.grid{grid-template-columns:1fr}}</style></head><body><main class="w"><span class="badge">XGuard v${VERSION} · canonical identity</span><h1>Connect to <span class="orange">Secretless Agent Gateway.</span></h1><p class="muted">Canonical MCP endpoint: <strong>${MCP}</strong>. The primary product is Secretless Egress: operators keep reusable upstream credentials in XGuard and agents receive scoped capabilities instead. ProofRail adds signed execution evidence.</p><div class="grid"><section class="c"><h2>Claude Code</h2><pre>claude mcp add xguard --transport http ${MCP}</pre></section><section class="c"><h2>Codex</h2><pre>[mcp_servers.xguard]\nurl = "${MCP}"</pre></section><section class="c"><h2>Cursor / VS Code</h2><p class="muted">Configure a remote Streamable HTTP MCP server with this URL:</p><pre>${MCP}</pre></section><section class="c"><h2>Machine discovery</h2><p><a class="btn" href="${SITE}/server.json">MCP manifest</a></p><p><a class="btn" href="${API}/openapi.json">OpenAPI</a></p></section></div><div class="notice"><strong>Primary identity:</strong> ${NAME}. Action Rail and x402 facilitator routing are compatibility rails. Historical ACE/Solana/BAM, Child Safety, Universal Facilitator and High-Velocity Facilitator descriptions are not the current XGuard product identity.</div><p class="foot">Secretless Egress · ProofRail · controlled agent API execution</p></main></body></html>`;
  return new Response(request.method === "HEAD" ? null : html, {
    status: 200,
    headers: baseHeaders(new Headers({
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-robots-tag": "index, follow",
    })),
  });
}

function canonicalSkill(request) {
  const body = `# ${NAME}\n\nVersion: ${VERSION}\nCanonical site: ${SITE}\nCanonical API: ${API}\nCanonical remote MCP: ${MCP}\n\n## Primary product\n\n${PRIMARY_PRODUCT}. Keep reusable upstream API credentials outside AI-agent context. Operators store encrypted credentials in XGuard and delegate short-lived scoped capabilities. XGuard validates capability and policy, commits Usage Credit billing, injects the reusable credential server-side and sends the permitted HTTPS request without returning the reusable secret to the agent.\n\nProofRail can attach ES256-signed execution evidence to authorized credential-backed outcomes.\n\n## Agent path\n\n- Discover: GET ${API}/v1/egress\n- Execute: POST ${API}/v1/egress/fetch\n- MCP: ${MCP}\n- ProofRail: GET ${API}/v1/proof\n\nCredential provisioning remains an operator-side management action and is intentionally not exposed as an agent MCP tool.\n\n## Compatibility only\n\nAction Rail and x402 facilitator endpoints remain supported compatibility rails. They do not replace the canonical product identity above. Historical descriptions involving XGuard ACE, Solana/BAM speed bumps, Child Safety, Universal Facilitator Gateway, High-Velocity x402 Facilitator or a generic spend-only control plane are not the current XGuard product identity.\n`;
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers: baseHeaders(new Headers({
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
    })),
  });
}

function normalizeAgentCard(body) {
  body.name = NAME;
  body.description = "Read-only discovery for XGuard Secretless Agent Gateway: canonical MCP/API metadata, Secretless Egress and ProofRail. Reusable credentials are not provisioned or exposed through this discovery surface.";
  body.version = VERSION;
  const skills = Array.isArray(body.skills) ? body.skills : [];
  if (!skills.some(skill => skill?.id === "xguard-secretless-egress")) {
    skills.unshift({
      id: "xguard-secretless-egress",
      name: "Secretless Agent Egress",
      description: "Discover how agents call credential-protected APIs with scoped XGuard capabilities while reusable upstream secrets remain server-side.",
      tags: ["secretless-egress", "credential-security", "ai-agent-security"],
    });
  }
  body.skills = skills;
}

function normalizePublicBody(pathname, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;

  body.canonical_identity = canonicalIdentity();

  if (pathname === "/docs") {
    body.name = NAME;
    body.version = VERSION;
    body.primary_product = PRIMARY_PRODUCT;
    body.primary_role = PRIMARY_ROLE;
    body.description = DESCRIPTION;
    body.compatibility_notice = "Action Rail and x402 facilitator routing are supported compatibility rails, not the primary XGuard product identity.";
  }

  if (pathname === "/architecture") {
    body.name = NAME;
    body.version = VERSION;
    body.product_version = VERSION;
    body.primary_product = PRIMARY_PRODUCT;
    body.primary_role = PRIMARY_ROLE;
  }

  if (pathname === "/openapi.json") {
    body.info = {
      ...(body.info || {}),
      title: NAME,
      version: VERSION,
      description: `${DESCRIPTION} Action Rail and x402 endpoints are compatibility surfaces.`,
    };
  }

  if (pathname === "/.well-known/xguard.json") {
    body.name = NAME;
    body.version = VERSION;
    body.product_version = VERSION;
    body.primary_product = PRIMARY_PRODUCT;
    body.primary_role = PRIMARY_ROLE;
  }

  if (pathname === "/.well-known/ai-plugin.json") {
    body.name_for_human = NAME;
    body.name_for_model = "xguard_secretless_agent_gateway";
    body.description_for_human = "Keep reusable API credentials out of AI agents and inject them only at controlled egress.";
    body.description_for_model = "Use XGuard Secretless Egress when an AI agent needs a credential-protected HTTPS API. Operators retain reusable secrets server-side; agents receive scoped capabilities. ProofRail provides signed execution evidence.";
  }

  if (pathname === "/.well-known/agent-card.json" || pathname === "/.well-known/agent.json") {
    normalizeAgentCard(body);
  }

  if (X402_DISCOVERY.has(pathname)) {
    body.parent_product = NAME;
    body.surface_role = "x402 compatibility rail";
    body.primary_product = PRIMARY_PRODUCT;
  }

  return body;
}

async function normalizeResponse(request, response) {
  if (!(response instanceof Response)) return response;
  const url = new URL(request.url);
  const headers = baseHeaders(response.headers);

  if (!PUBLIC_JSON.has(url.pathname) || !(headers.get("content-type") || "").includes("application/json") || !response.ok || request.method === "HEAD") {
    return new Response(request.method === "HEAD" ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const body = await response.clone().json().catch(() => null);
  if (!body || typeof body !== "object") {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  normalizePublicBody(url.pathname, body);
  headers.delete("content-length");
  return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const redirect = canonicalizeUrl(request);
    if (redirect) return redirect;

    const url = new URL(request.url);

    if (url.hostname === "api.xguardgate.com" && url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) {
      return apiRoot(request);
    }

    if (url.hostname === "xguardgate.com" && url.pathname === "/connect" && (request.method === "GET" || request.method === "HEAD")) {
      return connectPage(request);
    }

    if ((url.pathname === "/test" || url.pathname === "/agent-payment-safety-test") && url.hostname === "xguardgate.com" && (request.method === "GET" || request.method === "HEAD")) {
      return permanentRedirect(`${SITE}/`);
    }

    if (url.pathname === "/skill.md" && (request.method === "GET" || request.method === "HEAD")) {
      return canonicalSkill(request);
    }

    const response = await app.fetch(request, env, ctx);
    return normalizeResponse(request, response);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  },
};
