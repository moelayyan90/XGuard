const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=3600";

export function paymentLayerIndexResponse(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  const url = new URL(request.url);
  if (url.pathname === "/sitemap.xml") {
    return typedResponse(
      request,
      sitemap(url.origin),
      "application/xml; charset=utf-8",
    );
  }
  if (url.pathname === "/robots.txt") {
    return typedResponse(
      request,
      robots(url.origin),
      "text/plain; charset=utf-8",
    );
  }
  return null;
}

function sitemap(origin: string): string {
  const paths = [
    "/",
    "/payment-layer",
    "/install",
    "/.well-known/xguard/payment-layer.json",
    "/.well-known/xguard/protocols.json",
    "/.well-known/xguard/actions.json",
    "/.well-known/payment-manifest",
    "/docs",
    "/openapi.json",
    "/mcp",
    "/.well-known/mcp/server.json",
    "/.well-known/agent-card.json",
    "/.well-known/agent-market.json",
    "/discovery/resources",
    "/llms.txt",
    "/llms-full.txt",
    "/.well-known/x402/facilitator.json",
  ];
  const urls = paths
    .map((path) => `  <url><loc>${escapeXml(`${origin}${path}`)}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function robots(origin: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n\n# Primary XGuard Payment Layer\n# ${origin}/payment-layer\n# ${origin}/install\n# ${origin}/.well-known/xguard/payment-layer.json\n\n# Universal protocol, action, and agent discovery\n# ${origin}/.well-known/xguard/protocols.json\n# ${origin}/.well-known/xguard/actions.json\n# ${origin}/.well-known/payment-manifest\n# ${origin}/openapi.json\n# ${origin}/mcp\n# ${origin}/.well-known/mcp/server.json\n# ${origin}/.well-known/agent-card.json\n# ${origin}/.well-known/agent-market.json\n# ${origin}/discovery/resources\n# ${origin}/discovery/search?query=payment\n# ${origin}/llms.txt\n# ${origin}/llms-full.txt\n\n# Protocol-specific adapter\n# ${origin}/.well-known/x402/facilitator.json\n`;
}

function typedResponse(
  request: Request,
  value: string,
  contentType: string,
): Response {
  return new Response(request.method === "HEAD" ? null : value, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": CACHE_CONTROL,
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&apos;");
}
