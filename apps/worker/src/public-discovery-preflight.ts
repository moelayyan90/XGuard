const PUBLIC_DISCOVERY_PREFLIGHT_PATHS = new Set([
  "/.well-known/agent-card.json",
  "/.well-known/agent.json",
  "/.well-known/agent-market.json",
  "/.well-known/x402/facilitator.json",
  "/.well-known/x402.json",
  "/provider.json",
  "/openapi.json",
  "/llms.txt",
  "/llms-full.txt",
  "/robots.txt",
]);

export function publicDiscoveryPreflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;

  const url = new URL(request.url);
  if (!PUBLIC_DISCOVERY_PREFLIGHT_PATHS.has(url.pathname)) return null;

  return new Response(null, {
    status: 204,
    headers: {
      Allow: "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Accept, Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
