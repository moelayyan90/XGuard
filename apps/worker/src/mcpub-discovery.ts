const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

export function mcpubDiscoveryResponse(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  const url = new URL(request.url);
  if (url.pathname !== "/.well-known/mcp.json") return null;

  const body = {
    name: "XGuard",
    description:
      "Remote MCP server and x402 economic firewall for payment discovery, verification, and guarded settlement routing.",
    version: "0.4.0",
    transport: "streamable-http",
    mcp: `${url.origin}/mcp`,
    repository: "https://github.com/moelayyan90/XGuard",
    registryName: "io.github.moelayyan90/xguard",
  };

  return new Response(
    request.method === "HEAD" ? null : JSON.stringify(body, null, 2),
    {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": CACHE_CONTROL,
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
