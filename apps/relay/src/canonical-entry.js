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
  next.set("referrer-policy", "strict-origin-when-cross-origin");
  next.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  next.set("strict-transport-security", "max-age=31536000; includeSubDomains; preload");
  return next;
}

function htmlHeaders(pathname, nonce = "") {
  const script = nonce ? ` 'nonce-${nonce}'` : " 'none'";
  return baseHeaders(new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "public, max-age=300",
    "x-robots-tag": pathname.startsWith("/credits/") ? "noindex, nofollow" : "index, follow",
    "content-security-policy": `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action https://xguard.lemonsqueezy.com; img-src 'self' data:; style-src 'unsafe-inline'; script-src${script}; connect-src https://hooks.xguardgate.com`,
  }));
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
    headers: htmlHeaders("/connect"),
  });
}

const PAGE_STYLE = `body{margin:0;background:#0b0b0b;color:#f7f7f3;font-family:Arial,Helvetica,sans-serif}.w{width:min(920px,calc(100% - 32px));margin:auto;padding:64px 0}a{color:#ff6b35}h1{font-size:clamp(40px,7vw,72px);letter-spacing:-.05em;line-height:1;margin:16px 0 24px}.muted{color:#aaa;line-height:1.7}.badge{display:inline-block;border:1px solid #4a4a45;padding:7px 11px;font-size:12px}.card{border:1px solid #30302d;background:#131311;padding:24px;margin:28px 0}.price{font-size:40px;font-weight:800}.btn{border:0;display:inline-block;padding:13px 17px;background:#ff5a1f;color:#fff;text-decoration:none;font-weight:800;cursor:pointer}.btn[disabled]{opacity:.5}.key{word-break:break-all;background:#050505;border:1px solid #444;padding:14px}.foot{margin-top:42px;color:#777;font-size:12px}`;

function publicPage(request, pathname, title, heading, content, script = "") {
  const nonce = script ? randomNonce() : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="XGuard Secretless Agent Gateway"><link rel="canonical" href="${SITE}${pathname}"><style>${PAGE_STYLE}</style></head><body><main class="w"><span class="badge">XGuard v${VERSION} · Secretless Agent Gateway</span><h1>${heading}</h1>${content}<p class="foot"><a href="/">Home</a> · <a href="/connect">Connect</a> · <a href="/pricing">Pricing</a> · <a href="/security">Security</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/refund-policy">Refunds</a></p></main>${script ? `<script nonce="${nonce}">${script}</script>` : ""}</body></html>`;
  return new Response(request.method === "HEAD" ? null : html, { status: 200, headers: htmlHeaders(pathname, nonce) });
}

function randomNonce() { return crypto.randomUUID().replaceAll("-", ""); }

function pricingPage(request) {
  const content = `<p class="muted">One-time Usage Credits for controlled Secretless Egress. No subscription is represented by this package.</p><section class="card"><div class="price">JOD 3.550</div><h2>5,000 Usage Credits</h2><p class="muted">The current production policy consumes one credit for each authorized egress attempt, before the reusable credential is released and before the upstream request is sent. Taxes or provider totals, if any, are shown by Lemon Squeezy before payment.</p><button class="btn" id="checkout">Create secure checkout</button><div id="result" aria-live="polite"></div></section><p class="muted">Do not place the operator key in an AI prompt. XGuard stores only its SHA-256 hash. A checkout redirect is not proof of payment; credits become available only after a valid Lemon Squeezy webhook is processed.</p>`;
  const script = `const button=document.getElementById('checkout'),result=document.getElementById('result');button.addEventListener('click',async()=>{button.disabled=true;result.innerHTML='<p class="muted">Creating checkout…</p>';try{const response=await fetch('https://hooks.xguardgate.com/v1/checkout',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});const data=await response.json();if(!response.ok)throw new Error(data.error||'checkout_unavailable');result.innerHTML='<h3>Save your operator key before paying</h3><p class="key"></p><p><a class="btn" rel="noopener" href="'+data.checkout_url+'">Continue to Lemon Squeezy</a></p>';result.querySelector('.key').textContent=data.operator_key;}catch(error){result.innerHTML='<p class="muted">Checkout is not ready: '+String(error.message)+'</p>';button.disabled=false;}});`;
  return publicPage(request, "/pricing", "XGuard Pricing — Usage Credits", "Usage Credits, without a subscription.", content, script);
}

function contentPage(request, pathname) {
  if (pathname === "/security") return publicPage(request, pathname, "XGuard Security", "Security boundary.", `<div class="card"><h2>Secretless Egress</h2><p class="muted">Reusable upstream credentials are encrypted at rest and injected only after an exact host, segment-aware path, method, capability lifetime, call-budget and Usage Credit check. Redirects are not followed automatically. Private, local and XGuard-owned targets are blocked.</p></div><p class="muted">Security reports: <a href="mailto:mo.elayyan2023@gmail.com">mo.elayyan2023@gmail.com</a>. See <a href="${SITE}/.well-known/security.txt">security.txt</a>.</p>`);
  if (pathname === "/terms") return publicPage(request, pathname, "XGuard Terms", "Operational terms.", `<div class="card"><p class="muted">XGuard provides controlled API egress and execution evidence, not a guarantee that an upstream service will succeed. Each authorized egress attempt is billed before credential release. Users must have permission to use every credential and target they configure, and must not use XGuard for unlawful access, abuse, or evasion of third-party controls.</p><p class="muted">These concise operational terms require owner/legal review before material expansion of paid availability.</p></div>`);
  if (pathname === "/privacy") return publicPage(request, pathname, "XGuard Privacy", "Minimal data by design.", `<div class="card"><p class="muted">XGuard stores an irreversible hash of the operator key, encrypted credential material, scoped capability state, billing-event identifiers, balances and ledger entries needed to provide the service. It does not use customer email as the account key and does not return reusable upstream credentials to agents.</p><p class="muted">Payment details are collected by Lemon Squeezy, not by XGuard. Avoid placing personal data in labels, paths, headers or request bodies.</p></div>`);
  if (pathname === "/refund-policy") return publicPage(request, pathname, "XGuard Refund Policy", "Refunds reconcile against credits.", `<div class="card"><p class="muted">A provider-confirmed refund removes the proportional Usage Credits from the associated order. If those credits were already consumed, the account records refund debt and becomes restricted rather than silently creating a negative or inconsistent balance.</p><p class="muted">Eligibility and payment return timing are subject to the checkout provider and applicable requirements. Contact <a href="mailto:mo.elayyan2023@gmail.com">support</a> with the order identifier. This policy requires owner/legal review before material expansion of paid availability.</p></div>`);
  if (pathname === "/credits/success") return publicPage(request, pathname, "XGuard Checkout Status", "Payment submitted—not yet proven.", `<div class="card"><p class="muted">This redirect alone does not grant credits. XGuard credits the operator key only after a correctly signed Lemon Squeezy webhook identifies the paid order and its XGuard checkout session. Use your saved operator key with the balance API after processing completes.</p></div>`);
  if (pathname === "/credits/cancel") return publicPage(request, pathname, "XGuard Checkout Cancelled", "No payment confirmation, no credits.", `<div class="card"><p class="muted">The checkout was cancelled or not completed. XGuard does not grant Usage Credits from this page.</p><p><a class="btn" href="/pricing">Return to pricing</a></p></div>`);
  return null;
}

function robots(request) {
  const rules = `Allow: /\nDisallow: /v1/egress/credentials\nDisallow: /v1/egress/capabilities\nDisallow: /v1/balance\nDisallow: /v1/ledger\nDisallow: /v1/receipt/\nDisallow: /admin\nDisallow: /debug`;
  const text = `User-agent: *\n${rules}\n\nUser-agent: GPTBot\n${rules}\n\nUser-agent: ClaudeBot\n${rules}\n\nSitemap: ${SITE}/sitemap.xml\n`;
  return new Response(request.method === "HEAD" ? null : text, { headers: baseHeaders(new Headers({ "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" })) });
}

function sitemap(request) {
  const paths = ["/", "/connect", "/pricing", "/security", "/terms", "/privacy", "/refund-policy", "/identity", "/llms.txt", "/skill.md"];
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path => `<url><loc>${SITE}${path}</loc></url>`).join("")}</urlset>`;
  return new Response(request.method === "HEAD" ? null : xml, { headers: baseHeaders(new Headers({ "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" })) });
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
    body.paths ||= {};
    body.paths["/v1/proof"] ||= {
      get: {
        summary: "Discover XGuard ProofRail",
        description: "Returns the signed execution-evidence contract, verification endpoint and public-key URL.",
        responses: { "200": { description: "ProofRail discovery metadata" } },
      },
    };
    body.paths["/v1/proofs/verify"] ||= {
      post: {
        summary: "Verify a ProofRail compact proof",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["proof"], properties: { proof: { type: "string" } } } } } },
        responses: { "200": { description: "Proof validity and signed claims" }, "400": { description: "Malformed proof" } },
      },
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
    body.xguard = { ...(body.xguard || {}), version: VERSION, product_version: VERSION, primary_product: PRIMARY_PRODUCT, component_versions: { ...(body.xguard?.component_versions || {}), x402: "5.0.1" } };
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

  const contentType = (headers.get("content-type") || "").toLowerCase();
  const isJson = contentType.includes("application/json") || contentType.includes("+json");
  if (!PUBLIC_JSON.has(url.pathname) || !isJson || !response.ok || request.method === "HEAD") {
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

    if (url.hostname === "xguardgate.com" && url.pathname === "/pricing" && (request.method === "GET" || request.method === "HEAD")) return pricingPage(request);
    if (url.hostname === "xguardgate.com" && (request.method === "GET" || request.method === "HEAD")) {
      const page = contentPage(request, url.pathname);
      if (page) return page;
      if (url.pathname === "/robots.txt") return robots(request);
      if (url.pathname === "/sitemap.xml") return sitemap(request);
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
