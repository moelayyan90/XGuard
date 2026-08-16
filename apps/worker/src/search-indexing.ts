const XGUARD_VERSION = "0.4.0";
const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

export function searchIndexResponse(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  const url = new URL(request.url);
  const origin = url.origin;

  if (url.pathname === "/") {
    const accept = request.headers.get("accept") ?? "";
    if (accept.includes("text/html")) {
      return typedResponse(
        request,
        buildLandingPage(origin),
        "text/html; charset=utf-8",
      );
    }
    return jsonResponse(request, buildRootMetadata(origin));
  }

  if (url.pathname === "/sitemap.xml") {
    return typedResponse(
      request,
      buildSitemap(origin),
      "application/xml; charset=utf-8",
    );
  }

  if (url.pathname === "/robots.txt") {
    return typedResponse(
      request,
      buildRobots(origin),
      "text/plain; charset=utf-8",
    );
  }

  return null;
}

function buildRootMetadata(origin: string): Record<string, unknown> {
  return {
    name: "XGuard",
    title: "XGuard — x402 Economic Firewall & Facilitator Safety Gateway",
    version: XGUARD_VERSION,
    protocol: "x402-v2",
    mode: "mainnet",
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    price: {
      amount: "0.002",
      currency: "USD",
      event: "successful_billable_settlement",
      model: "merchant_prepaid_service_balance",
    },
    endpoints: {
      register: "/v1/register",
      balance: "/v1/balance",
      topUpIntent: "/v1/topups/intents",
      topUpClaim: "/v1/topups/claim",
      supported: "/supported",
      verify: "/verify",
      settle: "/settle",
      status: "/status",
    },
    discovery: {
      provider: `${origin}/.well-known/x402/facilitator.json`,
      agentCard: `${origin}/.well-known/agent-card.json`,
      agentMarket: `${origin}/.well-known/agent-market.json`,
      mcp: `${origin}/mcp`,
      mcpManifest: `${origin}/.well-known/mcp/server.json`,
      bazaarResources: `${origin}/discovery/resources`,
      bazaarSearch: `${origin}/discovery/search`,
      openapi: `${origin}/openapi.json`,
      llms: `${origin}/llms.txt`,
      llmsFull: `${origin}/llms-full.txt`,
      sitemap: `${origin}/sitemap.xml`,
    },
    repository: "https://github.com/moelayyan90/XGuard",
  };
}

function buildLandingPage(origin: string): string {
  const title = "XGuard — x402 Economic Firewall & Facilitator Safety Gateway";
  const description =
    "Hosted x402 v2 settlement-safety and facilitator-compatible gateway for Base mainnet USDC, with replay protection, finality verification, Bazaar discovery and MCP discovery.";
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "XGuard",
    applicationCategory: "DeveloperApplication",
    softwareVersion: XGUARD_VERSION,
    operatingSystem: "Web",
    description,
    url: origin,
    codeRepository: "https://github.com/moelayyan90/XGuard",
    offers: {
      "@type": "Offer",
      price: "0.002",
      priceCurrency: "USD",
      description: "Per successful billable settlement; no subscription.",
    },
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="${origin}/">
  <link rel="alternate" type="application/json" href="${origin}/.well-known/x402/facilitator.json" title="XGuard x402 provider metadata">
  <script type="application/ld+json">${jsonLd}</script>
</head>
<body>
  <main>
    <h1>XGuard — x402 Economic Firewall &amp; Facilitator Safety Gateway</h1>
    <p>${escapeHtml(description)}</p>
    <p>XGuard is live on Base mainnet and charges $0.002 only for a successful billable settlement.</p>
    <h2>Machine discovery</h2>
    <ul>
      <li><a href="/.well-known/x402/facilitator.json">x402 provider manifest</a></li>
      <li><a href="/.well-known/agent-card.json">Agent Card</a></li>
      <li><a href="/.well-known/mcp/server.json">MCP server metadata</a></li>
      <li><a href="/discovery/resources">Bazaar resources</a></li>
      <li><a href="/openapi.json">OpenAPI</a></li>
      <li><a href="/llms.txt">llms.txt</a></li>
      <li><a href="/sitemap.xml">Sitemap</a></li>
    </ul>
    <p><a href="https://github.com/moelayyan90/XGuard">Source code and documentation</a></p>
  </main>
</body>
</html>`;
}

function buildSitemap(origin: string): string {
  const paths = [
    "/",
    "/.well-known/x402/facilitator.json",
    "/.well-known/agent-card.json",
    "/.well-known/agent-market.json",
    "/.well-known/mcp/server.json",
    "/discovery/resources",
    "/openapi.json",
    "/llms.txt",
    "/llms-full.txt",
  ];
  const urls = paths
    .map((path) => `  <url><loc>${escapeXml(`${origin}${path}`)}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function buildRobots(origin: string): string {
  return `User-agent: *
Allow: /

Sitemap: ${origin}/sitemap.xml

# Machine-readable AI/service discovery
# ${origin}/.well-known/x402/facilitator.json
# ${origin}/.well-known/agent-card.json
# ${origin}/.well-known/agent-market.json
# ${origin}/.well-known/mcp/server.json
# ${origin}/mcp
# ${origin}/discovery/resources
# ${origin}/discovery/search?query=x402
# ${origin}/llms.txt
# ${origin}/llms-full.txt
# ${origin}/openapi.json
`;
}

function jsonResponse(request: Request, value: unknown): Response {
  return new Response(
    request.method === "HEAD" ? null : JSON.stringify(value, null, 2),
    {
      status: 200,
      headers: publicHeaders("application/json; charset=utf-8"),
    },
  );
}

function typedResponse(
  request: Request,
  value: string,
  contentType: string,
): Response {
  return new Response(request.method === "HEAD" ? null : value, {
    status: 200,
    headers: publicHeaders(contentType),
  });
}

function publicHeaders(contentType: string): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": CACHE_CONTROL,
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeXml(value: string): string {
  return escapeHtml(value).replaceAll("'", "&apos;");
}
