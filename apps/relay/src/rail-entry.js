import secure from "./secure-entry.js";
import rail from "./rail.js";
import market from "./x402-market.js";
import publicMetadata from "./public-metadata.js";

export { MerchantQuota, SettlementReceipt, AgentAuthority } from "./secure-entry.js";
export { RailKeyAuthority, RailPermitState, RailMeter } from "./rail.js";

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-labelledby="t d"><title id="t">XGuard</title><desc id="d">XGuard x402 facilitator mark</desc><rect width="512" height="512" rx="112" fill="#07090d"/><path d="M128 118h82l46 73 46-73h82l-87 138 91 138h-84l-48-76-48 76h-84l91-138z" fill="#4f8cff"/><circle cx="256" cy="256" r="196" fill="none" stroke="#87adff" stroke-width="12" opacity=".45"/></svg>`;
const LOGO_PNG_BASE64 = "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";

const DISCOVERY_PATHS = [
  "/",
  "/connect",
  "/logo.png",
  "/facilitator",
  "/docs",
  "/openapi.json",
  "/llms.txt",
  "/skill.md",
  "/supported",
  "/status",
  "/architecture",
  "/discovery/resources",
  "/.well-known/x402",
  "/.well-known/x402/facilitator.json",
  "/.well-known/agent-card.json",
  "/.well-known/ai-plugin.json",
  "/.well-known/mcp/server.json",
];

function publicBase(url) {
  if (url.hostname === "api.xguardgate.com") return "https://xguardgate.com/api";
  return "https://xguardgate.com";
}

function sitemap(base) {
  const urls = DISCOVERY_PATHS.map(path => `  <url><loc>${base}${path}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function decodeBase64Bytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function connectPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect XGuard 5.0.1 — MCP for Copilot, Claude, Cursor, VS Code and Cline</title><meta name="description" content="Install the XGuard High-Velocity x402 Facilitator remote MCP in GitHub Copilot, Claude Code, Cursor, VS Code or Cline."><link rel="canonical" href="https://xguardgate.com/connect"><style>body{margin:0;background:#07090d;color:#f5f7fb;font-family:Inter,system-ui,sans-serif}.w{width:min(900px,calc(100% - 32px));margin:auto;padding:64px 0}h1{font-size:clamp(42px,7vw,72px);letter-spacing:-.055em;margin:16px 0}.muted{color:#97a4b7;line-height:1.7}.badge{display:inline-block;border:1px solid #35578a;border-radius:99px;padding:7px 11px;color:#a9c6ff;font-size:12px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-top:32px}.c{border:1px solid #202938;border-radius:16px;background:#0d1118;padding:22px}.c h2{margin-top:0}.btn{display:inline-block;margin-top:10px;padding:11px 14px;border-radius:10px;background:#4f8cff;color:white;text-decoration:none;font-weight:800}code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}pre{white-space:pre-wrap;background:#080b10;border:1px solid #202938;padding:13px;border-radius:10px;color:#cfe0ff}.foot{margin-top:35px;color:#738095;font-size:12px}@media(max-width:680px){.grid{grid-template-columns:1fr}}</style></head><body><main class="w"><span class="badge">XGuard v5.0.1 · Remote Streamable HTTP MCP</span><h1>Connect XGuard.</h1><p class="muted">Canonical endpoint: <strong>https://xguardgate.com/api/mcp</strong>. Ten live tools expose x402 facilitator identity, route selection, Bazaar discovery, transaction inspection, safety checks, supported payment kinds, health and receipt lookup.</p><div class="grid"><section class="c"><h2>GitHub Copilot CLI</h2><pre>copilot plugin install moelayyan90/XGuard</pre><p class="muted">Or add the repository as a plugin marketplace.</p></section><section class="c"><h2>Claude Code</h2><pre>claude mcp add --transport http xguard https://xguardgate.com/api/mcp</pre></section><section class="c"><h2>Cursor</h2><p class="muted">One-click MCP installation.</p><a class="btn" href="cursor://anysphere.cursor-deeplink/mcp/install?name=xguard&config=eyJ4Z3VhcmQiOnsidXJsIjoiaHR0cHM6Ly9hcGkueGd1YXJkZ2F0ZS5jb20vbWNwIn19">Add to Cursor</a></section><section class="c"><h2>VS Code / Copilot</h2><p class="muted">Install the remote HTTP MCP configuration.</p><a class="btn" href="vscode:mcp/install?%7B%22name%22%3A%22xguard%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fapi.xguardgate.com%2Fmcp%22%7D">Install in VS Code</a></section><section class="c"><h2>Cline</h2><p class="muted">Add a Remote MCP Server named <code>xguard</code> with URL:</p><pre>https://xguardgate.com/api/mcp</pre></section><section class="c"><h2>Machine discovery</h2><p><a class="btn" href="https://xguardgate.com/api/.well-known/mcp/server.json">MCP metadata</a></p><p><a class="btn" href="https://xguardgate.com/api/openapi.json">OpenAPI</a></p></section></div><p class="foot">Non-custodial x402 v2 facilitator. XGuard does not claim downstream facilitator signer or settlement addresses as its own.</p></main></body></html>`;
}

function staticDiscovery(request) {
  const url = new URL(request.url);
  const isRead = request.method === "GET" || request.method === "HEAD";
  if (!isRead) return null;

  if (url.pathname === "/robots.txt") {
    const base = publicBase(url);
    const body = ["User-agent: *", "Allow: /", `Sitemap: ${base}/sitemap.xml`, ""].join("\n");
    return new Response(request.method === "HEAD" ? null : body, {status: 200, headers: {"content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff"}});
  }

  if (url.pathname === "/sitemap.xml") {
    const body = sitemap(publicBase(url));
    return new Response(request.method === "HEAD" ? null : body, {status: 200, headers: {"content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff"}});
  }

  if (url.pathname === "/connect") {
    return new Response(request.method === "HEAD" ? null : connectPage(), {status: 200, headers: {"content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300", "x-content-type-options": "nosniff", "x-frame-options": "DENY"}});
  }

  if (url.pathname === "/logo.svg") {
    return new Response(request.method === "HEAD" ? null : LOGO, {status: 200, headers: {"content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=86400, immutable", "x-content-type-options": "nosniff"}});
  }

  if (url.pathname === "/logo.png") {
    return new Response(request.method === "HEAD" ? null : decodeBase64Bytes(LOGO_PNG_BASE64), {status: 200, headers: {"content-type": "image/png", "content-length": "3252", "cache-control": "public, max-age=86400, immutable", "x-content-type-options": "nosniff", "x-xguard-image-dimensions": "400x400"}});
  }

  if (url.pathname === "/.well-known/security.txt") {
    const body = ["Contact: mailto:mo.elayyan2023@gmail.com", "Canonical: https://xguardgate.com/.well-known/security.txt", "Canonical: https://xguardgate.com/api/.well-known/security.txt", "Preferred-Languages: en, ar", "Policy: https://github.com/moelayyan90/XGuard/security", "Expires: 2027-08-27T00:00:00Z", ""].join("\n");
    return new Response(request.method === "HEAD" ? null : body, {status: 200, headers: {"content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff"}});
  }

  return null;
}

export default {
  async fetch(request, env, ctx) {
    const staticResponse = staticDiscovery(request);
    if (staticResponse instanceof Response) return staticResponse;
    const metadataResponse = await publicMetadata.fetch(request, env, ctx);
    if (metadataResponse instanceof Response) return metadataResponse;
    const marketResponse = await market.fetch(request, env, ctx);
    if (marketResponse instanceof Response) return marketResponse;
    const railResponse = await rail.fetch(request, env, ctx);
    if (railResponse instanceof Response) return railResponse;
    return secure.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    if (typeof secure.scheduled === "function") return secure.scheduled(controller, env, ctx);
  },
};
