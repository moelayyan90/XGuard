import secure from "./secure-entry.js";
import rail from "./rail.js";
import market from "./x402-market.js";
import publicMetadata from "./public-metadata.js";

export { MerchantQuota, SettlementReceipt, AgentAuthority } from "./secure-entry.js";
export { RailKeyAuthority, RailPermitState, RailMeter } from "./rail.js";

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-labelledby="t d"><title id="t">XGuard</title><desc id="d">XGuard x402 facilitator mark</desc><rect width="512" height="512" rx="112" fill="#07090d"/><path d="M128 118h82l46 73 46-73h82l-87 138 91 138h-84l-48-76-48 76h-84l91-138z" fill="#4f8cff"/><circle cx="256" cy="256" r="196" fill="none" stroke="#87adff" stroke-width="12" opacity=".45"/></svg>`;

const DISCOVERY_PATHS = [
  "/",
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
  if (url.hostname === "api.xguardgate.com") return "https://api.xguardgate.com";
  return "https://xguardgate.com";
}

function sitemap(base) {
  const urls = DISCOVERY_PATHS.map(path => `  <url><loc>${base}${path}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function staticDiscovery(request) {
  const url = new URL(request.url);
  const isRead = request.method === "GET" || request.method === "HEAD";
  if (!isRead) return null;

  if (url.pathname === "/robots.txt") {
    const base = publicBase(url);
    const body = [
      "User-agent: *",
      "Allow: /",
      `Sitemap: ${base}/sitemap.xml`,
      "",
    ].join("\n");
    return new Response(request.method === "HEAD" ? null : body, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  }

  if (url.pathname === "/sitemap.xml") {
    const body = sitemap(publicBase(url));
    return new Response(request.method === "HEAD" ? null : body, {
      status: 200,
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  }

  if (url.pathname === "/logo.svg") {
    return new Response(request.method === "HEAD" ? null : LOGO, {
      status: 200,
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "public, max-age=86400, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  }

  if (url.pathname === "/.well-known/security.txt") {
    const body = [
      "Contact: mailto:mo.elayyan2023@gmail.com",
      "Canonical: https://xguardgate.com/.well-known/security.txt",
      "Canonical: https://api.xguardgate.com/.well-known/security.txt",
      "Preferred-Languages: en, ar",
      "Policy: https://github.com/moelayyan90/XGuard/security",
      "Expires: 2027-08-27T00:00:00Z",
      "",
    ].join("\n");
    return new Response(request.method === "HEAD" ? null : body, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
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
