import { XGUARD_MCP_VERSION } from "./mainnet-mcp-modern.js";

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

export function mcpubDiscoveryResponse(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  const url = new URL(request.url);
  if (url.pathname !== "/.well-known/mcp.json") return null;

  const body = {
    name: "XGuard",
    description:
      "Payment coordination and safety MCP for AI agents, with pre-payment decisions, x402 discovery, and settlement evidence.",
    version: XGUARD_MCP_VERSION,
    transport: "streamable-http",
    mcp: `${url.origin}/mcp`,
    repository: "https://github.com/moelayyan90/XGuard",
    registryName: "io.github.moelayyan90/xguard",
    capabilities: {
      paymentIntent: true,
      paymentOffer: "xguard_payment_offer",
      paymentDecision: "xguard_payment_decision",
      x402Discovery: "xguard_discover",
      resourceDetails: "xguard_resource_details",
      status: "xguard_status",
      externalPaymentExecution: false,
    },
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
