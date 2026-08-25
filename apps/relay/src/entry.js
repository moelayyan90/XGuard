import worker from "./control-entry.js";
import authority, { enforceEdgeMandate } from "./authority.js";
import { ownersMetadataResponse } from "./owners-metadata.js";

export { MerchantQuota, SettlementReceipt } from "./control-entry.js";
export { AgentAuthority } from "./authority.js";

const OWNER_PATHS = new Set([
  "/.well-known/owners.json",
  "/mcp/.well-known/owners.json"
]);

function architectureResponse() {
  return new Response(JSON.stringify({
    name: "XGuard Universal Agent Transaction Control Plane",
    version: "4.1.0",
    description: "Protocol-neutral in-path transaction firewall, delegated spend authority, metering edge and settlement reliability layer for agent commerce.",
    architecture: {
      edge: "Cloudflare Workers",
      model: "stateless request control plane with Durable Objects for delegated spend mandates, quota and settlement receipt state",
      protocols: ["x402", "mpp", "ap2", "ucp", "acp", "mcp", "tap", "http"],
      flow: [
        "human or organization issues scoped XGuard mandate",
        "agent or merchant request",
        "protocol detection and policy inspection",
        "mandatory mandate authorization for financial agent actions",
        "request binding and safety checks",
        "authorized upstream forwarding",
        "successful transaction metering",
        "durable mandate, receipt and quota state"
      ]
    },
    discovery: {
      docs: "https://api.xguardgate.com/docs",
      openapi: "https://api.xguardgate.com/openapi.json",
      protocols: "https://api.xguardgate.com/v1/protocols",
      authority: "https://api.xguardgate.com/.well-known/xguard-authority.json",
      safety_test: "https://xguardgate.com/test",
      manifest: "https://api.xguardgate.com/.well-known/xguard.json",
      agent_card: "https://api.xguardgate.com/.well-known/agent-card.json",
      skill: "https://api.xguardgate.com/skill.md",
      llms: "https://api.xguardgate.com/llms.txt",
      mcp: "https://api.xguardgate.com/mcp",
      a2a: "https://api.xguardgate.com/a2a"
    }
  }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
      "x-xguard-control-plane": "4.1.0"
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;

    if (pathname === "/architecture" && (request.method === "GET" || request.method === "HEAD")) {
      const response = architectureResponse();
      if (request.method === "HEAD") return new Response(null, { status: response.status, headers: response.headers });
      return response;
    }

    if (OWNER_PATHS.has(pathname) && (request.method === "GET" || request.method === "HEAD")) {
      const response = ownersMetadataResponse();
      if (request.method === "HEAD") return new Response(null, { status: response.status, headers: response.headers });
      return response;
    }

    const authorityResponse = await authority.fetch(request, env, ctx);
    if (authorityResponse) return authorityResponse;

    if (pathname.startsWith("/edge/")) {
      const spend = await enforceEdgeMandate(request, env);
      if (spend instanceof Response) return spend;
      if (spend?.authorization_id) {
        const headers = new Headers(request.headers);
        headers.set("x-xguard-authorization-id", spend.authorization_id);
        headers.set("x-xguard-agent-id", spend.agent_id || "agent");
        request = new Request(request, { headers });
      }
    }

    return worker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof worker.scheduled === "function") return worker.scheduled(controller, env, ctx);
  }
};
